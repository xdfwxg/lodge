import { ASSIGNMENT_LEASE } from './turn-utils.js'

// 一条交接的租约就是队列里的一条到期项；同一个 id 再投就是续租。
export const leaseIdOf = (roomId, assignmentId) => `assignment-lease:${roomId}:${assignmentId}`

export const armAssignmentLease = ({
  store,
  roomId,
  assignmentId,
  stage,
  memberId,
  roundId = null,
  leaseMs = ASSIGNMENT_LEASE,
}) => {
  if (typeof assignmentId !== 'string' || assignmentId === '') return null
  return store.enqueueWork?.({
    id: leaseIdOf(roomId, assignmentId),
    roomId,
    roundId,
    kind: 'assignment.lease',
    payload: { assignmentId, stage, memberId },
    availableAt: Date.now() + leaseMs,
  }) ?? null
}

export const cancelAssignmentLease = ({ store, roomId, assignmentId }) => {
  if (typeof assignmentId !== 'string' || assignmentId === '') return
  store.cancelWork?.(leaseIdOf(roomId, assignmentId))
}
