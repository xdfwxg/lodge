// 平台执行交付自带的 lodge-proof.json：在一次性副本里跑，记录退出码和输出。
// 证明只回答一件事——「这份交付能不能重跑」：entry 跑绿，额外的 steps 也跑绿。
// 它不对账契约要求，那是验收员的复核；平台不解析语义，只看退出码。
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROOF_DIR, PROOF_FILE, normalizeProof } from '../../../../../shared/proof.js'
import { redactSecrets } from '../../../../../shared/secrets.js'
import { runCommand } from '../../../command-runner.js'
import { workspaceOf } from '../runtime/workspace.js'

const TIMEOUT_MS = 120_000
const OUTPUT_LIMIT = 8_000

const tail = text => String(text ?? '').slice(-OUTPUT_LIMIT)

// 单包阶段用根目录的 lodge-proof.json；并行阶段每个工作包一份 lodge-proof/<n>.json。
// 两种都在时都跑：根证明和分片各自是一条自证。
const proofFilesIn = root => {
  const files = []
  if (existsSync(join(root, PROOF_FILE))) {
    // 软链可以指向仓库外，不算交付里的证明。
    try {
      if (lstatSync(join(root, PROOF_FILE)).isFile()) files.push(PROOF_FILE)
    } catch {}
  }
  try {
    files.push(...readdirSync(join(root, PROOF_DIR))
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => `${PROOF_DIR}/${name}`))
  } catch {}
  return files
}

// 证明只能用交付里有的东西。成员私有目录（.lodge/）不随交付走，干净副本里没有；
// 辅助脚本要放进仓库（例如 tools/）或写成内联命令。
const PRIVATE_SUPPORT = /(^|[\s"'=])(?:\.lodge[\\/]|\/\.lodge\/)/i
const proofUsesPrivateSupport = proof => [proof.entry, ...proof.steps]
  .some(command => typeof command === 'string' && PRIVATE_SUPPORT.test(command))

const readProofAt = (root, file) => {
  try {
    const path = join(root, file)
    // 证明文件必须是交付里的普通文件；软链可以指向仓库外，直接当没有证明。
    if (!lstatSync(path).isFile()) return null
    return normalizeProof(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return null
  }
}

// 命令由基座在边界里跑；这里只把结果翻译成条目。
const execute = async (command, cwd) => {
  const startedAt = Date.now()
  try {
    const result = await runCommand({ cwd, command })
    return {
      exit: Number.isInteger(result?.code) ? result.code : null,
      timedOut: result?.timedOut === true,
      output: redactSecrets(tail([result?.stdout, result?.stderr].filter(Boolean).join('\n'))),
      durationMs: Number.isInteger(result?.durationMs) ? result.durationMs : Date.now() - startedAt,
    }
  } catch (error) {
    return {
      exit: null,
      timedOut: false,
      output: redactSecrets(`执行端口不可用：${String(error?.message ?? error)}`),
      durationMs: Date.now() - startedAt,
    }
  }
}

// 反例尝试也由平台在复核副本里执行；跑红（非 0）就是找到了反例。
export const runCommandInPath = async ({ cwd, command }) => {
  if (typeof cwd !== 'string' || cwd === '' || typeof command !== 'string' || command.trim() === '') {
    return { status: 'missing', exit: null, output: '' }
  }
  const result = await execute(command, cwd)
  const status = result.timedOut
    ? 'timeout'
    : result.exit === 0 ? 'passed' : result.exit === null ? 'error' : 'failed'
  return { status, ...result }
}

const baselineStatusOf = result => (
  result.timedOut ? 'timeout' : result.exit === 0 ? 'passed' : result.exit === null ? 'error' : 'failed'
)

// baseRef 是这一步开始前的版本：行为要变的步骤，证明在改动前必须失败（说明它绑定了这次改动）；
// 行为不变的步骤（重构、保持兼容）允许前后都过，靠 behavior 说清楚。
export const runProof = async ({ room, ref = null, baseRef = null, behavior = 'change', provider = null }) => {
  const at = new Date().toISOString()
  if (room === null || typeof room?.repoPath !== 'string' || room.repoPath === '') {
    return { status: 'missing', at, entry: '' }
  }
  const workspace = provider ?? workspaceOf(room)
  if (typeof workspace.isolatedCopy !== 'function') {
    return { status: 'unsupported', at, entry: '' }
  }
  let copy = null
  let base = null
  try {
    copy = workspace.isolatedCopy({ source: room.repoPath, ref })
    const files = proofFilesIn(copy.path)
    if (files.length === 0) return { status: 'missing', at, entry: '', files: [] }
    const proofs = files.map(file => ({ file, proof: readProofAt(copy.path, file) }))
    if (proofs.some(item => item.proof === null)) {
      return { status: 'invalid', at, entry: '', files, error: '证明文件格式不对' }
    }
    if (proofs.some(item => proofUsesPrivateSupport(item.proof))) {
      return {
        status: 'invalid',
        at,
        entry: '',
        files,
        error: '证明引用了成员私有目录（.lodge/）；辅助文件要随交付走（例如 tools/），不能放在不随交付走的目录里',
      }
    }
    if (typeof baseRef === 'string' && baseRef !== '') {
      try {
        base = workspace.isolatedCopy({ source: room.repoPath, ref: baseRef })
      } catch {
        base = null
      }
    }
    const entries = []
    const steps = []
    for (const { file, proof } of proofs) {
      const result = await execute(proof.entry, copy.path)
      const baseline = base === null
        ? { status: 'unknown', exit: null, timedOut: false }
        : await execute(proof.entry, base.path)
      entries.push({
        file,
        entry: proof.entry,
        status: result.exit === 0 && !result.timedOut ? 'verified' : 'failed',
        exit: result.exit,
        timedOut: result.timedOut,
        output: result.output,
        durationMs: result.durationMs,
        baseline: baselineStatusOf(baseline),
      })
      for (const run of proof.steps) {
        const step = await execute(run, copy.path)
        steps.push({
          file,
          run,
          status: step.exit === 0 && !step.timedOut ? 'verified' : 'failed',
          exit: step.exit,
          timedOut: step.timedOut,
          output: String(step.output ?? '').slice(-2_000),
          durationMs: step.durationMs,
        })
      }
    }
    const entriesVerified = entries.every(item => item.status === 'verified')
    const failedSteps = steps.filter(item => item.status !== 'verified')
    const verified = entriesVerified && failedSteps.length === 0
    // 行为要变的一步：证明入口在改动前也绿，就没有绑定这次改动。
    const weak = behavior !== 'preserve' && entries.some(item => item.baseline === 'passed')
    return {
      status: verified ? 'verified' : 'failed',
      at,
      entry: entries[0].entry,
      files,
      entries,
      steps,
      ...(failedSteps.length === 0
        ? {}
        : { error: `证明的 step 没跑绿：${failedSteps.slice(0, 3).map(item => item.run).join('；')}` }),
      behavior,
      weak,
      exit: entries[0].exit,
      timedOut: entries[0].timedOut,
      output: entries[0].output,
      durationMs: [...entries, ...steps].reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
    }
  } catch (error) {
    return {
      status: 'error',
      at,
      entry: '',
      error: String(error?.message ?? error).slice(0, 500),
    }
  } finally {
    for (const item of [copy, base]) {
      if (item !== null && typeof workspace.removeIsolatedCopy === 'function') {
        try { workspace.removeIsolatedCopy({ source: room.repoPath, copy: item }) } catch {}
      }
    }
  }
}
