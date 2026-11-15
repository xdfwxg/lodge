import { buildTimeline } from '../timeline-model.js'
import { isDispatchHandoff } from './handoff.js'

const pad = value => String(value).padStart(2, '0')

export const dayKey = ts => {
  if (typeof ts !== 'number' || !Number.isFinite(ts)) return null
  const date = new Date(ts)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const orderOf = message => (typeof message.ts === 'number' ? message.ts : 0) * 1000 + (typeof message.seq === 'number' ? message.seq : 0)

// 席位“我在等派发”是调度状态，不是房间里值得读的一句话。
const STANDBY = /待命|暂不动手|未派发/
export const isStandbyChat = (message, room) => (
  message?.kind === 'chat' &&
  message.authorId !== 'you' &&
  message.authorId !== room?.leadSeat &&
  STANDBY.test(String(message.text ?? ''))
)

// 工作室时间线要把过程步骤也拿回来；聊天室仍用原 Timeline。
export const orderTranscript = messages => {
  const timeline = buildTimeline(messages)
  const steps = timeline.process.filter(message => message.kind === 'activity')
  const items = [...timeline.visible, ...steps].sort((a, b) => orderOf(a) - orderOf(b))
  return { timeline, items }
}

export const stageChapterSummary = (items, room, index = null) => {
  const staged = Number.isInteger(index) && index >= 0 && Array.isArray(room?.messages)
    ? room.messages.filter(message => message.meta?.stage === index)
    : null
  const transfers = items.filter(item => item.kind === 'dispatch' || item.kind === 'handoff' || isDispatchHandoff(room, item)).length
  const evidence = (staged ?? items).filter(item => item.kind === 'evidence').length
  const verdicts = (staged ?? items).filter(item => item.kind === 'verdict' && item.meta?.human !== true).length
  const parts = []
  if (transfers > 0) parts.push(`${transfers} 次交接`)
  if (evidence > 0) parts.push(`${evidence} 条证据`)
  if (verdicts > 0) parts.push(`${verdicts} 次复核`)
  return parts.join(' · ')
}

// 阶段是工作室时间线的章节：当前阶段展开，已完成阶段收成一行，交付卡单独放在最后。
// 建房期的环境/引擎提示没有阶段，单独放进「准备」，不能混进第一阶段。
export const buildStageChapters = (items, room) => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const lastIndex = Math.max(stages.length - 1, 0)
  const active = stages.findIndex(stage => stage.state === 'active')
  const buckets = new Map()
  let current = stages.length === 0 ? -1 : 0
  let started = false
  for (const item of items) {
    const explicit = item?.meta?.stage
    if (Number.isInteger(explicit)) {
      current = Math.max(0, Math.min(explicit, lastIndex))
      started = true
    } else if (!started && item.kind === 'system') {
      // 建房期的环境/引擎提示没有阶段；房间一旦开口，后面的消息就属于当前阶段。
      current = -1
    } else {
      started = true
      if (current < 0 && stages.length > 0) current = 0
    }
    if (!buckets.has(current)) buckets.set(current, [])
    buckets.get(current).push(item)
  }
  if (active >= 0 && !buckets.has(active)) buckets.set(active, [])
  const ordered = [...buckets.entries()].sort((a, b) => a[0] - b[0])
  // 完成房间优先展开最后一段真正干活的阶段，而不是只放结论的收尾章节。
  const lastWork = ordered
    .filter(([, chapterItems]) => chapterItems.some(item => (
      item.kind === 'dispatch' ||
      item.kind === 'handoff' ||
      item.kind === 'evidence' ||
      item.kind === 'verdict' ||
      isDispatchHandoff(room, item)
    )))
    .at(-1)?.[0]
  const expandedIndex = active >= 0 ? active : (lastWork ?? ordered.at(-1)?.[0] ?? -1)
  return ordered.map(([index, chapterItems]) => {
    const stage = stages[index]
    return {
      kind: index < 0 ? 'prelude' : 'stage',
      key: index < 0 ? 'prelude' : `stage-${index}`,
      index,
      title: index < 0 ? (stages.length > 0 ? '准备' : '过程') : stage?.title ?? '过程',
      state: index < 0 ? null : stage?.state ?? 'active',
      expanded: index === expandedIndex,
      summary: stageChapterSummary(chapterItems, room, index),
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

const TOOL_LABELS = {
  bash: '运行命令',
  shell: '运行命令',
  read: '读取文件',
  write: '写入文件',
  edit: '修改文件',
  multiedit: '批量修改',
  applypatch: '应用改动',
  grep: '搜索内容',
  glob: '查找文件',
  ls: '列出目录',
  list: '列出目录',
  webfetch: '读取网页',
  websearch: '搜索网页',
  task: '分派任务',
  todowrite: '更新清单',
  notebookedit: '修改笔记',
}

const bareToolName = name => (
  name.startsWith('mcp__') ? name.replace(/^mcp__[^_]+__/, '') || name : name
)

// MCP 工具名是 mcp__server__tool；摘要里只留 tool，避免把内部字符串铺满一行。
export const displayToolName = name => {
  if (typeof name !== 'string' || name === '') return ''
  const bare = bareToolName(name)
  return TOOL_LABELS[bare.toLowerCase()] ?? bare
}

export const displayStepText = text => {
  if (typeof text !== 'string') return ''
  return TOOL_LABELS[text.trim().toLowerCase()] ?? text
}

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
    .map(([name, count]) => {
      const label = displayToolName(name)
      return count > 1 ? `${label} ×${count}` : label
    })
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
