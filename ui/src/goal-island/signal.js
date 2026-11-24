// What the island should say next, derived from the room alone.
// No React, no room-type branching: decisions come from needsYou, milestones
// from messages and stage transitions. The island shows at most one signal.
import { needsAction } from '../needs.js'

const DECISION_KINDS = new Set([
  'decision', 'question', 'rework', 'merge', 'parallel',
  'review-timeout', 'approval', 'error', 'mcp',
  'blocked', 'connection', 'budget',
])

const DECISION_TONE = {
  budget: 'paused',
  rework: 'paused',
  merge: 'paused',
  parallel: 'paused',
  'review-timeout': 'paused',
  error: 'paused',
  mcp: 'paused',
}

const clean = text => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)

const stageLabel = (room, value) => {
  if (!Number.isInteger(value) || value < 0) return ''
  const title = room?.stages?.[value]?.title
  return typeof title === 'string' && title !== ''
    ? `第 ${value + 1} 步「${title}」`
    : `第 ${value + 1} 步`
}

const withStage = (label, text) => (
  label === '' || text.startsWith(label) ? text : `${label} · ${text}`
)

const decisionText = (kind, label, fallback) => {
  switch (kind) {
    case 'decision': return label === '' ? '有一处要你拍板' : `${label}有一处要你拍板`
    case 'question': return '成员问了一个问题'
    case 'rework': return label === '' ? '有一步被退回了' : `${label}被验收退回了`
    case 'merge': return label === '' ? '合并没合上' : `${label}合并没合上`
    case 'parallel': return withStage(label, fallback === undefined || fallback === '' ? '这一步卡住了' : fallback)
    case 'review-timeout': return withStage(label, fallback === undefined || fallback === '' ? '复核没按时回来' : fallback)
    case 'approval': return '有一个操作要你点头'
    case 'error': return fallback === undefined || fallback === '' ? '有成员出错了' : fallback
    case 'mcp': return '连接断了'
    case 'connection': return fallback === undefined || fallback === '' ? '连接断了' : fallback
    case 'blocked': return withStage(label, fallback === undefined || fallback === '' ? '执行超时' : fallback)
    default: return fallback ?? '待处理'
  }
}

export const decisionOf = room => {
  const needs = needsAction(room)
  if (needs === null || !DECISION_KINDS.has(needs.kind)) return null
  const index = Number.isInteger(needs.stage) ? needs.stage : null
  const label = stageLabel(room, index)
  const fromChild = typeof needs.roomId === 'string' && needs.roomId !== room.id
  const childName = typeof needs.roomName === 'string' && needs.roomName !== '' ? needs.roomName : '子房间'
  const own = fromChild
    ? `${childName}：${needs.label ?? '待处理'}`
    : needs.decisionId !== undefined && typeof needs.label === 'string' && needs.label !== ''
      ? needs.label
      : decisionText(needs.kind, label, needs.label)
  const more = Array.isArray(room?.attention) ? room.attention.length - 1 : 0
  const missing = typeof needs.detail === 'string' && needs.detail !== '' ? needs.detail : ''
  return {
    key: fromChild
      ? `decision:${needs.roomId}:${needs.kind}:${index ?? '-'}`
      : `decision:${needs.kind}:${index ?? '-'}`,
    kind: 'decision',
    needs: needs.kind,
    stage: index,
    tone: DECISION_TONE[needs.kind] ?? 'waiting',
    title: more > 0 ? `${own} · 还有 ${more} 件` : own,
    // 说清缺什么、下一步怎么处理，不让人翻记录找原因。
    detail: fromChild
      ? missing || own
      : missing || (label === '' ? needs.label ?? '' : `${label} · ${needs.label ?? ''}`),
    action: 'open',
  }
}

export const baselineSeen = room => {
  const seen = new Set()
  for (const message of room?.messages ?? []) seen.add(`msg:${message.id}`)
  for (const [index, stage] of (room?.stages ?? []).entries()) {
    if (stage?.state === 'passed') seen.add(`stage:${index}:passed`)
  }
  return seen
}

const wrap = (priority, event) => ({ priority, event })

const eventForMessage = (room, message) => {
  const at = message.ts ?? message.seq ?? 0
  const key = `msg:${message.id}`
  switch (message.kind) {
    case 'chat_conclusion':
      return wrap(60, {
        key, kind: 'milestone', tone: 'done', at,
        title: '这轮聊完了',
        detail: clean(message.text),
      })
    case 'stage_conclusion': {
      const index = Number.isInteger(message.meta?.stage) ? message.meta.stage : null
      const title = typeof message.meta?.title === 'string' && message.meta.title !== ''
        ? message.meta.title
        : room?.stages?.[index]?.title
      const name = index === null
        ? '这一步'
        : title ? `第 ${index + 1} 步「${title}」` : `第 ${index + 1} 步`
      return wrap(50, {
        key, kind: 'milestone', tone: 'done', at,
        title: `${name}通过`,
        detail: message.meta?.next ? `下一步：${message.meta.next}` : '这一步已经通过',
      })
    }
    case 'child_result':
      return wrap(45, {
        key, kind: 'milestone', tone: 'active', at,
        title: `子房间「${message.meta?.childName ?? '子房间'}」交回结果`,
        detail: clean(message.text),
      })
    case 'verdict': {
      const pass = message.meta?.pass === true
      const index = Number.isInteger(message.meta?.stage) ? message.meta.stage : null
      return wrap(pass ? 40 : 55, {
        key, kind: 'milestone', tone: pass ? 'done' : 'paused', at,
        title: `${stageLabel(room, index) || '这一步'}${pass ? '通过' : '退回'}`,
        detail: clean(message.text),
      })
    }
    default:
      return null
  }
}

export const milestoneOf = (previous, room, seen = new Set()) => {
  if (room === null || room === undefined) return { event: null, seen: new Set(seen) }
  if (previous === null || previous === undefined || previous.id !== room.id) {
    return { event: null, seen: baselineSeen(room) }
  }
  const nextSeen = new Set(seen)
  const candidates = []
  for (const message of room.messages ?? []) {
    const key = `msg:${message.id}`
    if (nextSeen.has(key)) continue
    nextSeen.add(key)
    if (message.kind === 'stage_conclusion' && Number.isInteger(message.meta?.stage)) {
      nextSeen.add(`stage:${message.meta.stage}:passed`)
    }
    const candidate = eventForMessage(room, message)
    if (candidate !== null) candidates.push(candidate)
  }

  const stages = room.stages ?? []
  const previousStages = previous.stages ?? []
  stages.forEach((stage, index) => {
    if (stage?.state !== 'passed') return
    const key = `stage:${index}:passed`
    if (nextSeen.has(key)) return
    nextSeen.add(key)
    if (previousStages[index]?.state === 'passed') return
    const next = stages.slice(index + 1).find(item => item.state === 'pending')
    candidates.push(wrap(30, {
      key, kind: 'milestone', tone: 'done', at: 0,
      title: `${stageLabel(room, index)}通过`,
      detail: next?.title ? `下一步：${next.title}` : '这一步已经通过',
    }))
  })

  candidates.sort((a, b) => b.priority - a.priority || (b.event.at ?? 0) - (a.event.at ?? 0))
  return { event: candidates[0]?.event ?? null, seen: nextSeen }
}
