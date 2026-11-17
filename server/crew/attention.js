import { failureLabel } from '../../shared/failure.js'
import { pendingApprovals } from './external-actions.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { memberDisplayName } from './member-labels.js'

// 注意力路由：只在房间真的卡在人这里时返回一个信号；不是未读数。
// 通用状态在 kernel 判断，房型内部的“下一步该谁做”交给上下文 kind。
export const roomNeedsYou = (room, messages = []) => {
  if (room.state === 'active' && pendingApprovals(room).length > 0) {
    return { kind: 'approval', stage: null, label: '待确认' }
  }
  if (room.state === 'active' && room.live === true && typeof room.connectionError === 'string' && room.connectionError !== '') {
    return { kind: 'connection', stage: null, label: '连接中断' }
  }
  if (room.state === 'active' && room.blocked?.reason !== undefined) {
    return {
      kind: 'blocked',
      stage: Number.isInteger(room.blocked.stage) ? room.blocked.stage : null,
      label: room.blocked.reason === 'restart' ? '重启后未完成，需要你处理' : '执行超时，需要你退回重做',
    }
  }
  if (room.state === 'paused') {
    if (room.pauseReason === 'mcp') return { kind: 'mcp', stage: null, label: '连接中断' }
    if (room.pauseReason === 'approval') return { kind: 'approval', stage: null, label: '确认超时' }
    if (room.pauseReason === 'member_error') {
      const memberId = room.memberError?.memberId
      const name = memberId === undefined ? '成员' : memberDisplayName(room, memberId)
      return { kind: 'error', stage: null, label: failureLabel(room.memberError?.kind, name) }
    }
    return room.idle === true ? { kind: 'idle', stage: null, label: '可以接着聊' } : null
  }
  if (room.state !== 'active') return null
  return roomPresentationOfRoom(room)?.needsYou?.(room, messages) ?? null
}

// 收件箱：这间房自己等人处理的，加上子房里还在等你的。第一条给胶囊和侧栏，
// 其余的只在岛里列出来；不用再开第二个注意力来源。
export const roomAttention = (room, messages = [], children = []) => {
  const own = roomNeedsYou(room, messages)
  const items = own === null ? [] : [own]
  for (const child of children) {
    const childRoom = child?.room
    if (childRoom === undefined || childRoom === null || childRoom.state !== 'active') continue
    const needs = roomNeedsYou(childRoom, child.messages ?? [])
    if (needs === null) continue
    items.push({
      ...needs,
      roomId: childRoom.id,
      roomName: typeof childRoom.name === 'string' ? childRoom.name : childRoom.id,
    })
  }
  return items
}
