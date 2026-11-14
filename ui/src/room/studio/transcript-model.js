import { buildTimeline } from '../timeline-model.js'

const pad = value => String(value).padStart(2, '0')

export const dayKey = ts => {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const dayLabel = (ts, now = Date.now()) => {
  const key = dayKey(ts)
  if (key === null) return ''
  if (key === dayKey(now)) return '今天'
  if (key === dayKey(now - 86_400_000)) return '昨天'
  const date = new Date(ts)
  const year = date.getFullYear() === new Date(now).getFullYear() ? '' : `${date.getFullYear()}年`
  return `${year}${date.getMonth() + 1}月${date.getDate()}日`
}

const orderOf = message => (typeof message.ts === 'number' ? message.ts : 0) * 1000 + (typeof message.seq === 'number' ? message.seq : 0)

// 工作室时间线要把过程步骤也拿回来；聊天室仍用原 Timeline。
export const orderTranscript = messages => {
  const timeline = buildTimeline(messages)
  const steps = timeline.process.filter(message => message.kind === 'activity')
  const items = [...timeline.visible, ...steps].sort((a, b) => orderOf(a) - orderOf(b))
  return { timeline, items }
}

// 交付卡是房间在完成时刻的一条记录：按 completedAt 插回时间线，之后的新发言仍在它下面。
export const withDelivery = (items, delivery, roomId) => {
  if (delivery === null || delivery === undefined) return items
  const at = typeof delivery.completedAt === 'number' ? delivery.completedAt : (items.at(-1)?.ts ?? 0)
  const index = items.findIndex(item => typeof item.ts === 'number' && item.ts > at)
  const out = [...items]
  out.splice(index === -1 ? out.length : index, 0, {
    id: `delivery-${roomId}`,
    ts: at,
    kind: 'delivery',
  })
  return out
}

export const insertDayMarkers = (items, now = Date.now()) => {
  const out = []
  let lastKey = null
  for (const item of items) {
    const key = dayKey(item.ts)
    if (key !== null && key !== lastKey) {
      out.push({ kind: 'day', key: `day-${key}`, ts: item.ts, label: dayLabel(item.ts, now) })
      lastKey = key
    }
    out.push(item)
  }
  return out
}

const TOOL_NAME = /^[\w.:/-]+$/

// 工具名由投影给出；没有合法工具名的活动不算步骤。
export const stepLabel = step => (
  typeof step?.meta?.tool === 'string' && TOOL_NAME.test(step.meta.tool) ? step.meta.tool : ''
)

export const displayableStep = step => stepLabel(step) !== ''

const isStep = item => item.kind === 'activity' && item.meta?.ok !== false && displayableStep(item)

export const describeSteps = steps => {
  const counts = new Map()
  for (const step of steps) {
    const name = stepLabel(step)
    if (name === '') continue
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .slice(0, 3)
    .map(([name, count]) => (count > 1 ? `${name} ×${count}` : name))
  const extra = counts.size > 3 ? ` +${counts.size - 3}` : ''
  return `${steps.length} 步${parts.length > 0 ? ` · ${parts.join('、')}${extra}` : ''}`
}

export const groupSteps = items => {
  const out = []
  let group = null
  const flush = () => {
    if (group === null) return
    out.push(group.steps.length >= 2
      ? { kind: 'steps', key: `steps-${group.steps[0].id}`, authorId: group.authorId, ts: group.steps[0].ts, steps: group.steps }
      : group.steps[0])
    group = null
  }
  for (const item of items) {
    if (item.kind === 'day') {
      flush()
      out.push(item)
      continue
    }
    if (item.kind === 'activity' && item.meta?.ok !== false && !displayableStep(item)) continue
    if (isStep(item)) {
      if (group !== null && group.authorId === item.authorId && dayKey(group.steps[0].ts) === dayKey(item.ts)) {
        group.steps.push(item)
        continue
      }
      flush()
      group = { authorId: item.authorId, steps: [item] }
      continue
    }
    flush()
    out.push(item)
  }
  flush()
  return out
}

export const showsSeat = (items, index) => {
  const item = items[index]
  if (item === undefined || item.kind === 'day' || item.kind === 'steps') return false
  const previous = items[index - 1]
  if (previous === undefined || previous.kind === 'day') return true
  if (previous.kind === 'steps') return previous.authorId !== item.authorId
  if (previous.authorId === undefined) return true
  return previous.authorId !== item.authorId || dayKey(previous.ts) !== dayKey(item.ts)
}

export const presenceLines = (room, seats = []) => {
  const nameOf = id => seats.find(seat => seat.id === id)?.name ?? id
  const presence = Array.isArray(room?.presence) ? room.presence : []
  const queue = Array.isArray(room?.turnQueue) ? room.turnQueue : []
  const working = presence
    .filter(item => item.state === 'working')
    .map(item => ({ seatId: item.seatId, name: nameOf(item.seatId), since: room?.busySince ?? null }))
  const seen = new Set(working.map(item => item.seatId))
  const queued = queue
    .filter(item => item.state === 'queued' && !seen.has(item.seatId))
    .map(item => ({
      seatId: item.seatId,
      name: nameOf(item.seatId),
      position: item.position ?? null,
      of: item.of ?? null,
      waitingFor: item.waitingForSeatId === undefined ? '' : nameOf(item.waitingForSeatId),
    }))
  return { working, queued }
}
