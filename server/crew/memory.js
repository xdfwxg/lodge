import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'

// 房间记忆只读试点：只从已交付房间追加事实，不接收模型写入，也不进入提示词或验收。
const MAX_RECORD_BYTES = 4096
const MAX_FILE_BYTES = 1024 * 1024
const MAX_ENTRIES = 200

const clip = (value, max) => {
  const text = String(value ?? '').trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

const workspaceOf = room => {
  const path = typeof room?.sourceRepo === 'string' && room.sourceRepo !== '' ? room.sourceRepo : room?.repoPath
  return typeof path === 'string' && path !== '' ? resolve(path) : ''
}

export const memoryKeyFor = room => {
  const path = workspaceOf(room)
  return path === '' ? '' : createHash('sha256').update(path).digest('hex').slice(0, 24)
}

const recordOf = (room, messages) => {
  const ordered = Array.isArray(messages) ? messages : []
  const conclusion = [...ordered].reverse().find(message => message.kind === 'conclusion')
  const lastVerdict = [...ordered].reverse().find(message => message.kind === 'verdict')
  const conclusionText = lastVerdict === undefined
    ? conclusion?.text ?? room.name ?? ''
    : judgmentOf(lastVerdict)?.reason || lastVerdict.text || conclusion?.text || room.name
  const files = [...new Set(ordered.flatMap(message => (
    Array.isArray(message.meta?.changedFiles) ? message.meta.changedFiles : []
  )))].slice(0, 12).map(file => clip(file, 100))
  return {
    version: 1,
    roomId: room.id,
    roomName: clip(room.name, 120),
    goal: clip(room.goal, 500),
    conclusion: clip(conclusionText, 1000),
    stages: (Array.isArray(room.stages) ? room.stages : []).slice(0, 10).map(stage => ({
      title: clip(stage.title, 80),
      state: stage.state,
    })),
    files,
    commit: typeof room.completedCommit === 'string' && room.completedCommit !== '' ? room.completedCommit : null,
    completedAt: Number.isFinite(room.completedAt) ? room.completedAt : Date.now(),
    verdict: lastVerdict === undefined
      ? null
      : {
        pass: verdictPassed(lastVerdict),
        reason: clip(judgmentOf(lastVerdict)?.reason ?? lastVerdict.text, 500),
      },
    source: { kind: 'room', roomId: room.id },
  }
}

const readEntries = file => {
  if (!existsSync(file)) return []
  const entries = []
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line)
      if (value !== null && typeof value === 'object' && typeof value.roomId === 'string') entries.push(value)
    } catch {}
  }
  return entries
}

export const createRoomMemory = ({ root }) => {
  const fileFor = room => {
    const key = memoryKeyFor(room)
    return key === '' ? null : join(root, `${key}.jsonl`)
  }

  const appendRoom = ({ room, messages = [] }) => {
    if (room === null || typeof room !== 'object' || room.demo === true) return { ok: false, reason: 'demo' }
    const file = fileFor(room)
    if (file === null) return { ok: false, reason: 'no-workspace' }
    const entries = readEntries(file)
    if (entries.some(entry => entry.roomId === room.id)) return { ok: true, duplicate: true }
    if (entries.length >= MAX_ENTRIES) return { ok: false, reason: 'limit' }
    const record = recordOf(room, messages)
    const line = `${JSON.stringify(record)}\n`
    const bytes = Buffer.byteLength(line)
    if (bytes > MAX_RECORD_BYTES) return { ok: false, reason: 'record-too-large' }
    if (existsSync(file) && statSync(file).size + bytes > MAX_FILE_BYTES) return { ok: false, reason: 'file-too-large' }
    try {
      mkdirSync(root, { recursive: true })
      appendFileSync(file, line)
      return { ok: true, record }
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
  }

  const list = ({ room, limit = 20 }) => {
    const file = fileFor(room)
    if (file === null) return []
    const size = Math.max(1, Math.min(MAX_ENTRIES, Number(limit) || 20))
    return readEntries(file).slice(-size).reverse()
  }

  return { appendRoom, list }
}
