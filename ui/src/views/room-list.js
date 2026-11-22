import { chatStatusOf, idleDelivered } from '../../../shared/room-status.js'
import { CHAT_STATUS } from '../../../shared/states.js'
import { stripAttachmentTags } from '../../../shared/attachments.js'

const lastAtOf = room => (room.messages ?? [])
  .reduce((max, message) => Math.max(max, message.ts ?? 0), 0) || room.completedAt || 0
const byRecent = list => [...list].sort((a, b) => lastAtOf(b) - lastAtOf(a))
export const deliveredOf = room => room.modeCapabilities?.stages === false ? false : idleDelivered(room)

const pad = value => String(value).padStart(2, '0')
const stampOf = ts => {
  if (!Number.isFinite(ts) || ts <= 0) return ''
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 名字来自目标，相似目标会撞名；只在撞名时补一行时间，平时不打扰。
export const roomStampOf = (rooms, room) => {
  const sameName = (rooms ?? []).filter(item => !item.archivedAt && item.name === room?.name)
  return sameName.length > 1 ? stampOf(lastAtOf(room)) : ''
}

// 一条列表：先放待处理的，再放最近、完成、归档。类型不是分区。
export const orderRooms = rooms => {
  const pending = []
  const recent = []
  const done = []
  const archived = []
  for (const room of rooms) {
    if (room.archivedAt) archived.push(room)
    else if (room.needsYou) pending.push(room)
    else if (deliveredOf(room)) done.push(room)
    else recent.push(room)
  }
  return [...byRecent(pending), ...byRecent(recent), ...byRecent(done), ...byRecent(archived)]
}

export const SEARCH_MIN_ROOMS = 7

export const filterRooms = (rooms, query) => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return rooms
  return rooms.filter(room => [
    room.name,
    stripAttachmentTags(room.goal),
    roomLabelOf(room),
    room.needsYou?.label,
  ].some(value => typeof value === 'string' && value.toLowerCase().includes(needle)))
}

export const toneOf = room => {
  if (room.archivedAt) return 'idle'
  if (room.state === 'paused') return 'waiting'
  if (room.state === 'stopped') return 'idle'
  if (chatStatusOf(room) === CHAT_STATUS.concluded) return 'waiting'
  if (room.needsYou?.kind === 'review') return 'review'
  if (room.needsYou?.kind === 'signoff' || room.needsYou?.kind === 'result') return 'done'
  if (room.needsYou?.kind === 'rework' || room.needsYou?.kind === 'merge' || room.needsYou?.kind === 'parallel') return 'alert'
  if (room.needsYou) return 'waiting'
  if (deliveredOf(room)) return 'done'
  return room.live === true ? 'active' : 'idle'
}

const NEEDS_META = {
  result: '看结果',
  signoff: '待确认',
  review: '验收员在看',
  decision: '待确认',
  question: '待回答',
  setup: '补检查',
  rework: '待重做',
  merge: '待处理冲突',
  parallel: '待处理',
  approval: '待确认',
  idle: '可以继续',
  error: '没做成',
  budget: '额度用完',
  mcp: '连接中断',
  connection: '连接中断',
  blocked: '待处理',
}

// The row only shows a status word when the room needs you. Complete and live
// rooms stay quiet; the dot carries their state and the accessible label says it.
export const metaOf = room => room.archivedAt ? '' : room.needsYou ? NEEDS_META[room.needsYou.kind] ?? '待处理' : ''

const stateLabelOf = room => {
  if (room?.archivedAt) return '已归档'
  if (room?.modeCapabilities?.stages === false) {
    const status = chatStatusOf(room)
    if (status === CHAT_STATUS.concluded) return '聊到这儿了'
    if (status === CHAT_STATUS.summarizing) return '正在收一下'
    if ([CHAT_STATUS.running, CHAT_STATUS.thinking, CHAT_STATUS.discussing].includes(status)) return '正在聊'
    if (status === CHAT_STATUS.paused) return '已暂停'
    if (status === CHAT_STATUS.stopped) return '已停止'
    if (status === CHAT_STATUS.archived) return '已归档'
    return '还没开始聊'
  }
  if (deliveredOf(room)) return '已交付'
  if (room?.state === 'idle') return '空闲中'
  if (room?.state === 'stopped') return '已停止'
  if (room?.state === 'paused') return '已暂停'
  if (room?.state === 'active') return '进行中'
  return ''
}

// 可达名称：名称 + 状态 + 未读 + needsYou 文案，rail 态不依赖颜色也能读出来。
export const roomLabelOf = room => {
  const meta = metaOf(room)
  const parts = [room?.name ?? '房间']
  if (meta !== '') {
    parts.push(meta)
  } else {
    const state = stateLabelOf(room)
    if (state !== '') parts.push(state)
  }
  if (room?.chatUnread === true) parts.push('有新消息')
  if (room?.needsYou?.label && room.needsYou.label !== meta) parts.push(room.needsYou.label)
  return parts.join('，')
}
