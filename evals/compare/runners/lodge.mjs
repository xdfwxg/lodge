import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
export const checkFile = join(root, '..', 'checks', 'ledger.mjs')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const json = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body.slice(0, 300)}`)
  return body === '' ? null : JSON.parse(body)
}

const terminal = room => ['completed', 'rejected', 'failed', 'superseded', 'stopped'].includes(room?.workRound?.status)

const metricsOf = room => ({
  rework: (room.messages ?? []).filter(message => (
    message.kind === 'rework' ||
    (message.kind === 'verdict' && message.meta?.pass === false)
  )).length,
  human: room.lastPlannerDecision?.kind === 'human' ? 1 : 0,
  costMicroUsd: Number(room.usage?.costMicroUsd) || 0,
})

const waitFor = async ({ lodge, roomId, timeoutMs }) => {
  const deadline = Date.now() + timeoutMs
  let room = null
  while (Date.now() < deadline) {
    await sleep(2_000)
    let state = null
    try { state = await json(`${lodge}/api/state`) } catch { continue }
    room = state.rooms?.find(item => item.id === roomId) ?? room
    if (room !== null && terminal(room)) return { room, timedOut: false }
    if (room !== null && ['paused', 'stopped'].includes(room.state) && room.workRound === undefined) {
      return { room, timedOut: false }
    }
  }
  return { room, timedOut: true }
}

export const runLodgePhase = async ({ lodge, repo, phase, prompt, roomId = null, timeoutMs = 900_000 }) => {
  const startedAt = Date.now()
  let room = null
  if (roomId === null) {
    const created = await json(`${lodge}/api/rooms`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        goal: prompt,
        name: `对比 · ${phase}`,
        roomType: 'studio',
        verify: 'test',
        acceptance: `node check.mjs ${phase}`,
        repoPath: repo,
        members: ['lead', 'worker', 'verifier'].map(role => ({ role, engine: 'pi' })),
      }),
    })
    room = created.room ?? null
  } else {
    const started = await json(`${lodge}/api/rooms/${roomId}/rounds`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: prompt, verify: 'test', acceptance: `node check.mjs ${phase}` }),
    })
    if (started?.ok !== true && started?.room === undefined) {
      return { ok: false, pass: false, ms: Date.now() - startedAt, roomId, error: started?.error ?? 'round not started' }
    }
    room = started.room ?? null
  }
  if (room === null) return { ok: false, pass: false, ms: Date.now() - startedAt, roomId, error: 'room not created' }
  const waited = await waitFor({ lodge, roomId: room.id, timeoutMs })
  const current = waited.room ?? room
  // 用外部尺子核对最终工作区，不读房间自述。
  const candidates = [...new Set([
    current.repoPath,
    current.sourceRepo,
    ...Object.values(current.worktrees ?? {}),
  ].filter(item => typeof item === 'string' && item !== '' && existsSync(item)))]
  let check = { pass: false, output: `no candidate passed: ${candidates.join(', ')}`, repo: null }
  for (const candidate of candidates) {
    const result = spawnSync(process.execPath, [checkFile, phase, candidate], { encoding: 'utf8', timeout: 30_000 })
    if (result.status === 0) { check = { pass: true, output: String(result.stdout ?? '').trim(), repo: candidate }; break }
    check.output = String(result.stdout ?? result.stderr ?? '').trim()
  }
  const metrics = metricsOf(current)
  return {
    ok: waited.timedOut !== true,
    pass: check.pass,
    ms: Date.now() - startedAt,
    roomId: current.id,
    costMicroUsd: metrics.costMicroUsd,
    rework: metrics.rework,
    human: metrics.human,
    output: check.output,
    error: waited.timedOut ? 'room timed out' : null,
  }
}

export const cleanupRoom = async ({ lodge, roomId }) => {
  if (typeof roomId !== 'string' || roomId === '') return []
  const errors = []
  for (const action of ['archive', 'delete']) {
    try {
      await json(`${lodge}/api/rooms/${roomId}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action === 'archive' ? { archived: true } : {}),
      })
    } catch (error) {
      errors.push(String(error?.message ?? error))
    }
  }
  return errors
}
