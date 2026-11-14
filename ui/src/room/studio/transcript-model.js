import { buildTimeline } from '../timeline-model.js'
import { isDispatchHandoff } from './handoff.js'

const pad = value => String(value).padStart(2, '0')

export const dayKey = ts => {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const orderOf = message => (typeof message.ts === 'number' ? message.ts : 0) * 1000 + (typeof message.seq === 'number' ? message.seq : 0)

// 工作室时间线要把过程步骤也拿回来；聊天室仍用原 Timeline。
export const orderTranscript = messages => {
  const timeline = buildTimeline(messages)
  const steps = timeline.process.filter(message => message.kind === 'activity')
  const items = [...timeline.visible, ...steps].sort((a, b) => orderOf(a) - orderOf(b))
  return { timeline, items }
}

export const stageChapterSummary = (items, room) => {
  const transfers = items.filter(item => item.kind === 'dispatch' || isDispatchHandoff(room, item)).length
  const evidence = items.filter(item => item.kind === 'evidence').length
  const verdicts = items.filter(item => item.kind === 'verdict' && item.meta?.human !== true).length
  const parts = []
  if (transfers > 0) parts.push(`${transfers} 次交接`)
  if (evidence > 0) parts.push(`${evidence} 条证据`)
  if (verdicts > 0) parts.push(`${verdicts} 次复核`)
  return parts.length > 0 ? parts.join(' · ') : `${items.length} 条记录`
}

// 阶段是工作室时间线的章节：当前阶段展开，已完成阶段收成一行，交付卡单独放在最后。
export const buildStageChapters = (items, room) => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const lastIndex = Math.max(stages.length - 1, 0)
  const buckets = new Map()
  let current = stages.length > 0 ? 0 : -1
  for (const item of items) {
    const explicit = item?.meta?.stage
    if (Number.isInteger(explicit)) current = Math.max(0, Math.min(explicit, lastIndex))
    const index = stages.length > 0 ? current : -1
    if (!buckets.has(index)) buckets.set(index, [])
    buckets.get(index).push(item)
  }
  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  const active = stages.findIndex(stage => stage.state === 'active')
  const expandedIndex = active >= 0 ? active : (ordered.at(-1)?.[0] ?? -1)
  return ordered.map(([index, chapterItems]) => {
    const stage = stages[index]
    return {
      kind: 'stage',
      key: `stage-${index}`,
      index,
      title: stage?.title ?? '过程',
      state: stage?.state ?? 'active',
      expanded: index === expandedIndex,
      summary: stageChapterSummary(chapterItems, room),
      items: chapterItems,
    }
  })
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
