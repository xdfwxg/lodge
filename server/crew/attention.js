import { failureLabel, failureNextStep } from '../../shared/failure.js'
import { pendingApprovals } from './external-actions.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { memberDisplayName } from './member-labels.js'

// 注意力路由：只在房间真的卡在人这里时返回一个信号；不是未读数。
// 通用状态在 kernel 判断，房型内部的“下一步该谁做”交给上下文 kind。
export const roomNeedsYou = (room, messages = []) => {
  if (room.state === 'active' && pendingApprovals(room).length > 0) {
    return { kind: 'approval', stage: null, label: '待确认' }
  }
  // 基座的问答卡也在等人：最后一张没回答，就把房间标成需要你。
  const card = [...messages].reverse().find(message => (
    message.kind === 'question' && typeof message.meta?.card?.requestId === 'string'
  ))
  if (room.state === 'active' && card !== undefined) {
    const requestId = card.meta.card.requestId
    const answered = (Array.isArray(room.cardAnswers) && room.cardAnswers.includes(requestId)) ||
      messages.some(message => (
        message.kind === 'system' &&
        message.meta?.kind === 'card-answered' &&
        message.meta?.requestId === requestId
      ))
    if (!answered) {
      const permission = card.meta.card.requestType === 'permission'
      return permission
        ? { kind: 'approval', stage: null, label: '有一个操作要你点头', detail: '允许或拒绝后，这一步继续。' }
        : { kind: 'question', stage: null, label: '待回答', detail: '有成员在等你的回答。' }
    }
  }
  if (room.state === 'active' && room.live === true && typeof room.connectionError === 'string' && room.connectionError !== '') {
    return { kind: 'connection', stage: null, label: '连接断了', detail: '模型服务掉线了；连上后点继续。' }
  }
  if (room.state === 'active' && room.blocked?.reason !== undefined) {
    const workers = Array.isArray(room.blocked.workers) ? room.blocked.workers : []
    const names = workers.map(id => memberDisplayName(room, id)).join('、')
    return {
      kind: 'blocked',
      stage: Number.isInteger(room.blocked.stage) ? room.blocked.stage : null,
      label: room.blocked.reason === 'restart'
        ? '重启后没接着做'
        : room.blocked.reason === 'no-progress'
          ? '重做后没有新的改动'
          : room.blocked.reason === 'check-failed'
            ? typeof room.blocked.command === 'string' && room.blocked.command !== ''
              ? `检查没通过：${room.blocked.command}`
              : '检查没通过'
            : names === '' ? '执行超时' : `执行超时：${names}停下了`,
      detail: room.blocked.reason === 'restart'
        ? '点继续，或退回重做这一步。'
        : room.blocked.reason === 'no-progress'
          ? '让规划师换个做法，或退回重做这一步。'
          : room.blocked.reason === 'check-failed'
            ? '让规划师安排重做，或退回重做这一步。'
            : '退回重做，或叫停后重新派活。',
    }
  }
  if (room.state === 'paused') {
    if (room.pauseReason === 'mcp') return { kind: 'mcp', stage: null, label: '连接中断' }
    if (room.pauseReason === 'approval') return { kind: 'approval', stage: null, label: '确认超时' }
    if (room.pauseReason === 'member_error') {
      const memberId = room.memberError?.memberId
      const name = memberId === undefined ? '成员' : memberDisplayName(room, memberId)
      return {
        kind: 'error',
        stage: null,
        label: failureLabel(room.memberError?.kind, name),
        detail: failureNextStep(room.memberError?.kind),
      }
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
