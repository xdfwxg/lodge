import { ASSIGNMENT_LEASE } from '../runtime/turn-utils.js'
import { WORK_ITEM_STATUS } from '../../../../../shared/states.js'

// 一条交接的租约就是队列里的一条到期项；同一个 id 再投就是续租。
export const leaseIdOf = (roomId, assignmentId) => `assignment-lease:${roomId}:${assignmentId}`

let renewalSeq = 0

export const armAssignmentLease = ({
  store,
  roomId,
  assignmentId,
  stage,
  memberId,
  roundId = null,
  leaseMs = ASSIGNMENT_LEASE,
  id = null,
}) => {
  if (typeof assignmentId !== 'string' || assignmentId === '') return null
  return store.enqueueWork?.({
    id: id ?? leaseIdOf(roomId, assignmentId),
    roomId,
    roundId,
    kind: 'assignment.lease',
    payload: { assignmentId, stage, memberId },
    availableAt: Date.now() + leaseMs,
  }) ?? null
}

// 成员还在动就续租。续租必须换一个新 id：调度器处理完这一条会把它标成 done，
// 同一个 id 再也回不到 pending（那条规则是为了不重放历史动作）。
export const renewAssignmentLease = options => armAssignmentLease({
  ...options,
  id: `${leaseIdOf(options.roomId, options.assignmentId)}:${renewalSeq += 1}`,
})

// 取消要连续租一起：租约是一族 id，不只是最初那一条。
export const cancelAssignmentLease = ({ store, roomId, assignmentId }) => {
  if (typeof assignmentId !== 'string' || assignmentId === '') return
  const prefix = leaseIdOf(roomId, assignmentId)
  for (const item of store.readWork?.(roomId) ?? []) {
    if (typeof item.id !== 'string' || !item.id.startsWith(prefix)) continue
    if (item.status !== WORK_ITEM_STATUS.pending) continue
    store.cancelWork?.(item.id)
  }
}
