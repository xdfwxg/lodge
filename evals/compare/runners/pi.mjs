import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
export const checkFile = join(root, '..', 'checks', 'ledger.mjs')

export const runCheck = ({ repo, phase }) => {
  const result = spawnSync(process.execPath, [checkFile, phase, repo], { encoding: 'utf8', timeout: 30_000 })
  return {
    pass: result.status === 0,
    output: String(result.stdout ?? '').trim() || String(result.stderr ?? '').trim(),
  }
}

export const runPiPhase = ({ repo, phase, prompt, session = null, timeoutMs = 300_000 }) => {
  const startedAt = Date.now()
  const args = ['-p', prompt, '--mode', 'json']
  if (session === null) args.push('--no-session')
  else args.push('--session-id', session)
  const result = spawnSync('pi', args, { cwd: repo, encoding: 'utf8', timeout: timeoutMs })
  const lines = String(result.stdout ?? '').split('\n').filter(Boolean)
  let tokens = 0
  let costMicroUsd = 0
  let calls = 0
  let lastText = ''
  for (const line of lines) {
    let event = null
    try { event = JSON.parse(line) } catch { continue }
    if (event.type !== 'message_end') continue
    const message = event.message ?? {}
    if (message.role !== 'assistant') continue
    calls += 1
    tokens += Number(message.usage?.totalTokens) || 0
    costMicroUsd += Math.round((Number(message.usage?.cost?.total) || 0) * 1_000_000)
    if (Array.isArray(message.content)) {
      lastText = message.content.filter(item => item.type === 'text').map(item => item.text).join('') || lastText
    }
  }
  const check = runCheck({ repo, phase })
  return {
    ok: result.status === 0,
    pass: check.pass,
    ms: Date.now() - startedAt,
    tokens,
    costMicroUsd,
    calls,
    output: check.output,
    reply: lastText.slice(-500),
    error: result.status === 0 ? null : String(result.stderr ?? '').slice(-800),
  }
}
