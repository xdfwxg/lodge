// 平台执行交付自带的 lodge-proof.json：在一次性副本里跑，记录退出码和输出。
// 证明没写、格式不对、命令不绿，都如实落成状态，不替执行方解释。
import { exec, execSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROOF_FILE, normalizeProof } from '../../../../shared/proof.js'
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

const readProof = room => {
  try {
    const file = join(room.repoPath, PROOF_FILE)
    // 证明文件必须是交付里的普通文件；软链可以指向仓库外，直接当没有证明。
    if (!lstatSync(file).isFile()) return null
    return normalizeProof(JSON.parse(readFileSync(file, 'utf8')))
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

export const runProof = async ({ room, ref = null, provider = null }) => {
  const at = new Date().toISOString()
  if (room === null || typeof room?.repoPath !== 'string' || room.repoPath === '') {
    return { status: 'missing', at, entry: '' }
  }
  const proof = readProof(room)
  if (proof === null) return { status: 'missing', at, entry: '' }
  const workspace = provider ?? workspaceOf(room)
  if (typeof workspace.isolatedCopy !== 'function') {
    return { status: 'unsupported', at, entry: proof.entry }
  }
  let copy = null
  try {
    copy = workspace.isolatedCopy({ source: room.repoPath, ref })
    const result = await execute(proof.entry, copy.path)
    return {
      status: result.exit === 0 && !result.timedOut ? 'verified' : 'failed',
      at,
      entry: proof.entry,
      exit: result.exit,
      timedOut: result.timedOut,
      output: result.output,
      durationMs: result.durationMs,
    }
  } catch (error) {
    return {
      status: 'error',
      at,
      entry: proof.entry,
      error: String(error?.message ?? error).slice(0, 500),
    }
  } finally {
    if (copy !== null && typeof workspace.removeIsolatedCopy === 'function') {
      try { workspace.removeIsolatedCopy({ source: room.repoPath, copy }) } catch {}
    }
  }
}
