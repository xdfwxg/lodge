import { createHash, randomUUID } from 'node:crypto'
import { createAssignment, transitionAssignment, updateAssignment } from '../../assignments.js'
import { armAssignmentLease } from './assignment-lease.js'
import { ASSIGNMENT_STATUS } from '../../../../shared/states.js'

// 一拍交接的身份：同一拍重投仍幂等，新一拍（新一轮重做、换了父任务）必须生成新 Assignment。
const assignmentDigest = ({ roomId, index, from, to, reason, acceptance, evidence, candidate, rework, parentAssignmentId, nonce }) => (
  createHash('sha256')
    .update(JSON.stringify({
      roomId,
      index,
      from,
      to,
      reason,
      acceptance,
      evidenceId: evidence?.id ?? '',
      candidate: candidate ?? '',
      rework,
      parentAssignmentId: parentAssignmentId ?? '',
      nonce,
    }))
    .digest('hex')
    .slice(0, 32)
)

const LEASE_MS = 30 * 60_000
const leaseOf = () => {
  const at = Date.now()
  return { token: randomUUID(), at, expiresAt: at + LEASE_MS }
}

// 接力只做一件事：写一条 Assignment，再把它投递给目标成员。
// 群里那条 @ 由 projection.js 统一投影，这里不写消息，也不拼 @。
export const createHandoff = ({ store, roomId, sendToMember, emit }) => {
  const trigger = async ({
    room,
    stage,
    index,
    from,
    to,
    reason,
    prompt,
    acceptance,
    evidence = null,
    verdict = null,
    candidate = null,
    rework = false,
    context = {},
    parentAssignmentId = null,
    privateRoom = false,
    nonce = '',
  }) => {
    const current = store.readRoom(roomId) ?? room
    const body = String(prompt ?? '').trim()
    const deliveryKey = `a-${assignmentDigest({ roomId, index, from, to, reason, acceptance, evidence, candidate, rework, parentAssignmentId, nonce })}`
    const existing = store.readAssignment(deliveryKey, roomId)
    // 已经交回或正在做的交接不再重复唤醒；同一次交接只发一次。
    if (existing !== null && ['sent', 'working', 'reported', 'passed', 'rejected', 'cancelled'].includes(existing.status)) {
      return existing
    }
    // 只有“送达失败”的那条能重开；工作失败（超时、没产出、退回）是另一拍。
    const deliveryRetry = existing !== null &&
      existing.status === ASSIGNMENT_STATUS.failed &&
      existing.deliveryFailed === true
    const created = existing === null || (existing.status === ASSIGNMENT_STATUS.failed && !deliveryRetry)
    const brief = {
      stageTitle: stage?.title ?? '',
      kind: stage?.kind ?? '',
      goal: current.goal ?? '',
      done: Array.isArray(current.plan?.done) ? current.plan.done.slice(0, 6) : [],
      constraints: Array.isArray(current.constraints) ? current.constraints.slice(0, 6) : [],
      acceptance: acceptance ?? stage?.acceptance ?? '',
      prompt: body,
    }
    const nextContext = {
      ...context,
      ...(candidate === null ? {} : { candidate }),
      ...(evidence?.id === undefined ? {} : { evidenceId: evidence.id }),
      ...(verdict?.id === undefined ? {} : { verdictId: verdict.id }),
    }
    const assignment = created
      ? createAssignment({
        store,
        id: existing === null ? deliveryKey : `${deliveryKey}-${randomUUID().slice(0, 8)}`,
        roomId,
        stageIndex: index,
        fromMemberId: from,
        toMemberId: to,
        reason,
        brief,
        context: nextContext,
        evidenceIds: evidence?.id === undefined ? [] : [evidence.id],
        parentAssignmentId: existing === null ? parentAssignmentId : existing.id,
        status: ASSIGNMENT_STATUS.created,
      })
      : existing
    if (deliveryRetry) {
      // 同一拍重开：带上这次调用最新的 brief/context，别让账本停在旧内容上。
      updateAssignment(store, assignment.id, {
        brief,
        context: nextContext,
        ...(evidence?.id === undefined
          ? {}
          : { evidenceIds: [...new Set([...(assignment.evidenceIds ?? []), evidence.id])] }),
      })
    }
    if (created) {
      store.appendEvent(roomId, 'assignment.created', {
        assignmentId: assignment.id,
        stage: index,
        from,
        to,
        reason,
      })
    }
    const sentPatch = () => ({
      sendId: assignment.id,
      sentAt: Date.now(),
      lease: leaseOf(),
      finishedAt: null,
      resultText: '',
      deliveryFailed: false,
      turnId: null,
    })
    try {
      await sendToMember(to, body, {
        intent: reason === 'review' ? 'review' : 'handoff',
        from,
        sendId: assignment.id,
        ...(privateRoom === true ? { privateRoom: true } : {}),
      })
      const sent = transitionAssignment(store, assignment.id, 'sent', sentPatch())
      armAssignmentLease({
        store,
        roomId,
        assignmentId: assignment.id,
        stage: index,
        memberId: to,
        roundId: store.readRoom(roomId)?.workRound?.id ?? null,
      })
      return sent ?? assignment
    } catch (error) {
      const reasonText = String(error?.message ?? error)
      transitionAssignment(store, assignment.id, 'failed', {
        resultText: reasonText,
        deliveryFailed: true,
      })
      throw error
    }
  }

  return { trigger }
}
