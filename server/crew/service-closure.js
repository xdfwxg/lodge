import { fail, ok } from './result.js'
import { studioTransitionEvent, transitionStudio } from './room-state.js'

// closure 只属于工作室。Planner 只能在进入执行前拒绝目标，执行后收归 Verifier。
export const createServiceClosure = ({ store, emit, dispatchPayload, plannerMcp = null }) => {
  const rejectPlan = (room, body = {}) => {
    if (room.roomType !== 'studio') return fail('invalid', '只有工作室有 closure')
    if (room.state !== 'active') return fail('conflict', '房间不在进行中')
    if (room.closure !== 'planned') {
      return fail('conflict', room.closure === 'rejected' ? '目标已经被拒绝' : '只有 planned 阶段可以由 Planner 拒绝目标')
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 2000) : ''
    if (reason === '') return fail('invalid', '拒绝目标需要理由')
    const moved = transitionStudio(room.closure, 'reject_plan')
    if (!moved.ok) return fail('conflict', moved.error)
    const updated = store.updateRoom(room.id, current => {
      if (current.closure !== 'planned') return null
      current.closure = moved.state
      current.state = 'stopped'
      current.pauseReason = 'rejected'
      return { events: [{ type: 'plan.rejected', payload: { reason } }, studioTransitionEvent(moved, 'reject_plan', room.leadSeat ?? 'planner')] }
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
