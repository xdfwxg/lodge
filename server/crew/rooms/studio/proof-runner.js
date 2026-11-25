// 平台执行交付自带的 lodge-proof.json：在一次性副本里跑，记录退出码和输出。
// 证明没写、格式不对、命令不绿，都如实落成状态，不替执行方解释。
import { exec, execSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PROOF_DIR, PROOF_FILE, normalizeProof } from '../../../../shared/proof.js'
import { redactSecrets } from '../../../../shared/secrets.js'
import { workspaceOf } from './workspace.js'

const TIMEOUT_MS = 120_000
const OUTPUT_LIMIT = 8_000
const SECRET_KEY = /(token|secret|password|passwd|api[_-]?key|auth|credential|cookie)/i

const proofEnv = () => {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || SECRET_KEY.test(key)) continue
    env[key] = value
  }
  env.CI = '1'
  env.LODGE_PROOF = '1'
  return env
}

const tail = text => String(text ?? '').slice(-OUTPUT_LIMIT)

// 单包阶段用根目录的 lodge-proof.json；并行阶段每个工作包一份 lodge-proof/<n>.json。
const proofFilesIn = root => {
  if (existsSync(join(root, PROOF_FILE))) {
    // 软链可以指向仓库外，不算交付里的证明。
    try {
      if (lstatSync(join(root, PROOF_FILE)).isFile()) return [PROOF_FILE]
    } catch {}
  }
  try {
    return readdirSync(join(root, PROOF_DIR))
      .filter(name => name.endsWith('.json'))
      .sort()
      .map(name => `${PROOF_DIR}/${name}`)
  } catch {
    return []
  }
}

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

const execute = (command, cwd) => new Promise(resolve => {
  const startedAt = Date.now()
  exec(command, {
    cwd,
    timeout: TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    env: proofEnv(),
    shell: true,
  }, (error, stdout, stderr) => {
    resolve({
      exit: error === null ? 0 : (Number.isInteger(error.code) ? error.code : null),
      timedOut: error?.killed === true,
      output: redactSecrets(tail([stdout, stderr].filter(Boolean).join('\n'))),
      durationMs: Date.now() - startedAt,
    })
  })
})

// 反例尝试也由平台在复核副本里执行；跑红（非 0）就是找到了反例。
export const runCommandInPathSync = ({ cwd, command }) => {
  if (typeof cwd !== 'string' || cwd === '' || typeof command !== 'string' || command.trim() === '') {
    return { status: 'missing', exit: null, output: '' }
  }
  const startedAt = Date.now()
  try {
    const stdout = execSync(command, {
      cwd,
      timeout: TIMEOUT_MS,
      maxBuffer: 10 * 1024 * 1024,
      env: proofEnv(),
      encoding: 'utf8',
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return {
      status: 'passed',
      exit: 0,
      timedOut: false,
      output: redactSecrets(tail(stdout)),
      durationMs: Date.now() - startedAt,
    }
  } catch (error) {
    return {
      status: 'failed',
      exit: Number.isInteger(error?.status) ? error.status : null,
      timedOut: error?.killed === true,
      output: redactSecrets(tail([error?.stdout, error?.stderr].filter(Boolean).join('\n'))),
      durationMs: Date.now() - startedAt,
    }
  }
}

const baselineStatusOf = result => (
  result.timedOut ? 'timeout' : result.exit === 0 ? 'passed' : result.exit === null ? 'error' : 'failed'
)

// baseRef 是这一步开始前的版本：行为要变的步骤，证明在改动前必须失败；
// 行为不变的步骤（重构、保持兼容）允许前后都过，靠 proof.behavior 说清楚。
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
    if (typeof baseRef === 'string' && baseRef !== '') {
      try {
        base = workspace.isolatedCopy({ source: room.repoPath, ref: baseRef })
      } catch {
        base = null
      }
    }
    const entries = []
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
    }
    const verified = entries.every(item => item.status === 'verified')
    const weak = behavior !== 'preserve' && entries.some(item => item.baseline === 'passed')
    return {
      status: verified ? 'verified' : 'failed',
      at,
      entry: entries[0].entry,
      files,
      entries,
      behavior,
      weak,
      exit: entries[0].exit,
      timedOut: entries[0].timedOut,
      output: entries[0].output,
      durationMs: entries.reduce((sum, item) => sum + (item.durationMs ?? 0), 0),
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
