import { pendingApprovals } from './external-actions.js'
import { roomPresentationOfRoom } from './rooms/kinds.js'
import { seatDisplayName } from './seat-labels.js'

// 注意力路由：只在房间真的卡在人这里时返回一个信号；不是未读数。
// 通用状态在 kernel 判断，房型内部的“下一步该谁做”交给上下文 kind。
export const roomNeedsYou = (room, messages = []) => {
  if (room.state === 'active' && pendingApprovals(room).length > 0) {
    return { kind: 'approval', stage: null, label: '等你批准外部动作' }
  }
  if (room.state === 'paused') {
    if (room.pauseReason === 'budget') return { kind: 'budget', stage: null, label: '预算已用尽 · 等你处理' }
    if (room.pauseReason === 'mcp') return { kind: 'mcp', stage: null, label: 'MCP 熔断 · 等你恢复' }
    if (room.pauseReason === 'approval') return { kind: 'approval', stage: null, label: '外部动作审批超时 · 等你处理' }
    if (room.pauseReason === 'seat_error') {
      const seat = room.seatError?.seat
      const name = seat === undefined ? '席位' : seatDisplayName(room, seat)
      const label = room.seatError?.kind === 'quota'
        ? `${name}额度不足 · 等你处理`
        : room.seatError?.kind === 'auth'
          ? `${name}登录失效 · 等你处理`
          : room.seatError?.kind === 'rate_limit'
            ? `${name}被限流 · 等你处理`
            : `${name}调用失败 · 等你处理`
      return { kind: 'error', stage: null, label }
    }
    return room.idle === true ? { kind: 'idle', stage: null, label: '等你说话' } : null
  }
  if (room.state !== 'active') return null
  return roomPresentationOfRoom(room)?.needsYou?.(room, messages) ?? null
}
