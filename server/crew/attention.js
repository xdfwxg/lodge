import { pendingApprovals } from './external-actions.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { seatDisplayName } from './seat-labels.js'

// 注意力路由：只在房间真的卡在人这里时返回一个信号；不是未读数。
// 通用状态在 kernel 判断，房型内部的“下一步该谁做”交给上下文 kind。
export const roomNeedsYou = (room, messages = []) => {
  if (room.state === 'active' && pendingApprovals(room).length > 0) {
    return { kind: 'approval', stage: null, label: '待确认' }
  }
  if (room.state === 'paused') {
    if (room.pauseReason === 'mcp') return { kind: 'mcp', stage: null, label: '连接中断' }
    if (room.pauseReason === 'approval') return { kind: 'approval', stage: null, label: '确认超时' }
    if (room.pauseReason === 'seat_error') {
      const seat = room.seatError?.seat
      const name = seat === undefined ? '成员' : seatDisplayName(room, seat)
      const label = room.seatError?.kind === 'quota'
        ? `${name}的模型额度不够`
        : room.seatError?.kind === 'auth'
          ? `${name}的登录失效了`
          : room.seatError?.kind === 'rate_limit'
            ? `${name}被模型服务限流了`
            : `${name}没能回应`
      return { kind: 'error', stage: null, label }
    }
    return room.idle === true ? { kind: 'idle', stage: null, label: '可以接着聊' } : null
  }
  if (room.state !== 'active') return null
  return roomPresentationOfRoom(room)?.needsYou?.(room, messages) ?? null
}
