import { fail, ok } from './result.js'

// closure 只属于工作室。Planner 只能在进入执行前拒绝目标，执行后收归 Verifier。
export const createServiceClosure = ({ store, emit, dispatchPayload, plannerMcp = null }) => {
  const rejectPlan = (room, body = {}) => {
    if (room.roomType !== 'studio') return fail('invalid', '只有工作室有 closure')
    if (room.state !== 'active') return fail('conflict', '房间不在进行中')
    if (!['open', 'planned'].includes(room.closure)) {
      return fail('conflict', room.closure === 'rejected' ? '目标已经被拒绝' : '已经进入执行/验收，不能由 Planner 单方面终止')
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''
    if (reason === '') return fail('invalid', '拒绝目标需要理由')
    const updated = store.updateRoom(room.id, current => {
      if (!['open', 'planned'].includes(current.closure)) return null
      current.closure = 'rejected'
      current.state = 'stopped'
      current.pauseReason = 'rejected'
      return { events: [{ type: 'plan.rejected', payload: { reason } }] }
    })
    if (updated === null) return fail('conflict', '房间状态已变化，重试')
    const message = store.appendMessage(room.id, {
      kind: 'plan_rejection',
      authorId: room.leadSeat ?? 'planner',
      text: reason,
      meta: { roleKind: 'planner', closure: 'rejected', at: Date.now() },
    })
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    void plannerMcp?.release?.(room.id)
    return ok({ room: updated, message })
  }

  return { rejectPlan }
}
