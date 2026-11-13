import { fail, ok } from './result.js'
import { canPromoteTrust, trustLevelOf } from './trust.js'

// 信任级别是房间策略：升级要证据，降级随时可以，变更留事件与消息。
export const createServiceTrust = ({ store, emit, dispatchPayload }) => {
  const { readMessages, updateRoom, appendMessage } = store

  const setTrust = (room, body) => {
    const level = body?.level
    const check = canPromoteTrust(room, readMessages(room.id), level)
    if (!check.ok) return fail('invalid', check.error)
    const previous = trustLevelOf(room)
    const reason = typeof body?.reason === 'string' && body.reason.trim() !== ''
      ? body.reason.trim().slice(0, 240)
      : '手动调整'
    const updated = updateRoom(room.id, current => {
      current.trust = level
      current.trustReason = reason
      current.trustChangedAt = Date.now()
      return {
        events: [{ type: 'trust.changed', payload: { from: previous, to: level, reason } }],
      }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    appendMessage(room.id, {
      kind: 'system',
      text: `信任级别：${previous} → ${level}（${reason}）。`,
    })
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    return ok({ room: updated })
  }

  return { setTrust }
}
