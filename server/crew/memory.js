import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'
import { progressOf } from '../../shared/progress.js'

// 房间记忆：只从已交付房间追加事实，人工审核后才对新房间可见；不接收模型写入。
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
    kind: 'memory',
    roomId: room.id,
    roomName: clip(room.name, 120),
    goal: clip(room.goal, 500),
    conclusion: clip(conclusionText, 1000),
    stages: (Array.isArray(room.stages) ? room.stages : []).slice(0, 10).map(stage => ({
      title: clip(stage.title, 80),
      state: stage.state,
    })),
    files,
    progress: (() => {
      const progress = progressOf(room, ordered)
      return {
        done: progress.done.map(stage => clip(stage.title, 80)),
        remaining: progress.remaining.map(stage => clip(stage.title, 80)),
        next: progress.next === null ? null : clip(progress.next, 120),
      }
    })(),
    commit: typeof room.completedCommit === 'string' && room.completedCommit !== ''
      ? room.completedCommit
      : (typeof room.workspaceHead === 'string' && room.workspaceHead !== '' ? room.workspaceHead : null),
    commitSource: typeof room.completedCommit === 'string' && room.completedCommit !== ''
      ? 'room'
      : (typeof room.workspaceHead === 'string' && room.workspaceHead !== '' ? 'workspace-head' : null),
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

const readState = file => {
  const memories = new Map()
  const reviews = new Map()
  if (!existsSync(file)) return { memories, reviews }
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (line.trim() === '') continue
    try {
      const value = JSON.parse(line)
      if (value === null || typeof value !== 'object') continue
      if (value.kind === 'review' && typeof value.memoryId === 'string') {
        reviews.set(value.memoryId, { decision: value.decision, at: value.at ?? 0 })
      } else if (typeof value.roomId === 'string') {
        memories.set(value.roomId, value)
      }
    } catch {}
  }
  return { memories, reviews }
}

const statusOf = (memoryId, reviews) => {
  const decision = reviews.get(memoryId)?.decision
  if (decision === 'approve') return 'approved'
  if (decision === 'reject') return 'rejected'
  if (decision === 'delete') return 'deleted'
  return 'draft'
}

const visibleEntry = (entry, reviews) => ({
  ...entry,
  status: statusOf(entry.roomId, reviews),
  reviewedAt: reviews.get(entry.roomId)?.at ?? null,
})

export const createRoomMemory = ({ root }) => {
  const fileFor = room => {
    const key = memoryKeyFor(room)
    return key === '' ? null : join(root, `${key}.jsonl`)
  }

  const list = ({ room, limit = 20 }) => {
    const file = fileFor(room)
    if (file === null) return []
    const size = Math.max(1, Math.min(MAX_ENTRIES, Number(limit) || 20))
    const { memories, reviews } = readState(file)
    return [...memories.values()]
      .filter(entry => statusOf(entry.roomId, reviews) !== 'deleted')
      .slice(-size)
      .reverse()
      .map(entry => visibleEntry(entry, reviews))
  }

  const shared = ({ room, sourceRepo = '', limit = 3 }) => {
    const target = room ?? (sourceRepo === '' ? null : { sourceRepo })
    const file = target === null ? null : fileFor(target)
    if (file === null) return []
    const { memories, reviews } = readState(file)
    const size = Math.max(1, Math.min(10, Number(limit) || 3))
    return [...memories.values()]
      .filter(entry => statusOf(entry.roomId, reviews) === 'approved')
      .slice(-size)
      .reverse()
      .map(entry => ({
        roomId: entry.roomId,
        goal: entry.goal,
        conclusion: entry.conclusion,
        files: Array.isArray(entry.files) ? entry.files : [],
        completedAt: entry.completedAt,
      }))
  }

  const appendRoom = ({ room, messages = [] }) => {
    if (room === null || typeof room !== 'object' || room.demo === true) return { ok: false, reason: 'demo' }
    const file = fileFor(room)
    if (file === null) return { ok: false, reason: 'no-workspace' }
    const { memories } = readState(file)
    if (memories.has(room.id)) return { ok: true, duplicate: true }
    if (memories.size >= MAX_ENTRIES) return { ok: false, reason: 'limit' }
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

  const review = ({ room, memoryId, decision }) => {
    if (!['approve', 'reject', 'delete'].includes(decision)) return { ok: false, reason: 'invalid' }
    const file = fileFor(room)
    if (file === null) return { ok: false, reason: 'no-workspace' }
    const { memories } = readState(file)
    if (typeof memoryId !== 'string' || !memories.has(memoryId)) return { ok: false, reason: 'not_found' }
    const line = `${JSON.stringify({ kind: 'review', memoryId, decision, at: Date.now() })}\n`
    const bytes = Buffer.byteLength(line)
    if (existsSync(file) && statSync(file).size + bytes > MAX_FILE_BYTES) return { ok: false, reason: 'file-too-large' }
    try {
      mkdirSync(root, { recursive: true })
      appendFileSync(file, line)
      return { ok: true, entries: list({ room }) }
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
  }

  return { appendRoom, list, shared, review }
}
