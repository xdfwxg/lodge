import { chatStatusOf, idleDelivered } from '../../../../shared/room-status.js'
import { stripAttachmentTags } from '../../../../shared/attachments.js'
import { CHAT_STATUS, ROOM_STATE, ROUND_STATUS } from '../../../../shared/states.js'

const MAX_ROOMS = 3
const MAX_TEXT = 240

const clip = text => {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value
}

const conclusionOf = messages => {
  const last = [...(Array.isArray(messages) ? messages : [])].reverse()
    .find(message => message.kind === 'chat_conclusion' || message.kind === 'conclusion')
  return clip(last?.text)
}

const statusOf = room => {
  if (room.roomType === 'chat') {
    const status = chatStatusOf(room)
    if (status === CHAT_STATUS.concluded) return '已有结论'
    if ([CHAT_STATUS.running, CHAT_STATUS.discussing, CHAT_STATUS.summarizing, CHAT_STATUS.thinking].includes(status)) {
      return '还在讨论'
    }
    if (status === CHAT_STATUS.paused) return '暂停'
    if (status === CHAT_STATUS.stopped) return '已停止'
    return '还没开始'
  }
  if (idleDelivered(room) || room.workRound?.status === ROUND_STATUS.completed) return '已交付'
  if (room.state === ROOM_STATE.active) return '还在做'
  if (room.state === ROOM_STATE.paused) return '暂停'
  return '已停'
}

// 从这里开出去的房：子房写 sourceRoomId，开房消息写 openRoomId，两个都是当前真相。
// 只给主持状态和最后一轮结论，不给整段对话。
export const linkedRoomBriefs = ({ store, room, limit = MAX_ROOMS }) => {
  if (room === null || room === undefined) return []
  const rooms = store.readRooms?.() ?? []
  const order = new Map(rooms.map((item, index) => [item.id, index]))
  const ids = []
  const seen = new Set()
  const add = id => {
    if (typeof id !== 'string' || id === '' || id === room.id || seen.has(id)) return
    seen.add(id)
    ids.push(id)
  }
  for (const item of rooms) {
    if (item.sourceRoomId === room.id) add(item.id)
  }
  for (const message of store.readMessages?.(room.id) ?? []) {
    add(message.meta?.openRoomId)
  }
  const size = Math.max(1, limit)
  return ids
    .map(id => ({ id, index: order.get(id) ?? -1, child: store.readRoom?.(id) ?? null }))
    .filter(item => item.child !== null && !item.child.archivedAt)
    .sort((a, b) => a.index - b.index)
    .slice(-size)
    .map(({ child }) => {
      const messages = store.readMessages?.(child.id) ?? []
      return {
        id: child.id,
        name: child.name ?? '房间',
        goal: stripAttachmentTags(child.goal ?? ''),
        status: statusOf(child),
        conclusion: conclusionOf(messages),
      }
    })
}
