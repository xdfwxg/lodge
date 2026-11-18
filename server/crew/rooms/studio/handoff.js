import { createHash, randomUUID } from 'node:crypto'
import { memberDisplayName } from '../../member-labels.js'
import { createAssignment, transitionAssignment } from '../../assignments.js'

const assignmentDigest = ({ roomId, index, from, to, reason, acceptance, evidence, candidate, rework }) => (
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
    }))
    .digest('hex')
    .slice(0, 32)
)

// 接力只做一件事：写一条 Assignment，再把它投递给目标成员。
// 消息是这次 Assignment 的界面投影，不是交接事实的第二份存储。
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
    message = '',
    visible = true,
    deliver = true,
    evidence = null,
    verdict = null,
    candidate = null,
    rework = false,
    context = {},
    parentAssignmentId = null,
    privateRoom = false,
  }) => {
    const current = store.readRoom(roomId) ?? room
    const body = String(prompt ?? '').replace(/^@\S+\s*/, '').trim()
    const label = memberDisplayName(current, to)
    const step = `第 ${index + 1} 步${stage?.title ? `「${stage.title}」` : ''}`
    const check = acceptance === 'manual' || acceptance === undefined || acceptance === ''
      ? ''
      : `，验收跑 ${acceptance}`
    const summary = String(message ?? '').trim() !== ''
      ? String(message).trim()
      : reason === 'review'
        ? `@${label} ${step}做完了，帮我复核一下。`
        : rework
          ? `@${label} ${step}还得再改一下。`
          : `@${label} ${step}交给你了${check}。`
    const deliveryKey = `a-${assignmentDigest({ roomId, index, from, to, reason, acceptance, evidence, candidate, rework })}`
    const existing = store.readAssignment(deliveryKey)
    // 已经交回或正在做的交接不再重复唤醒；同一次交接只发一次。
    if (existing !== null && ['working', 'reported', 'passed', 'rejected', 'cancelled'].includes(existing.status)) {
      return existing
    }
    // 失败是一次可重试的送达，不是同一条记录回退：新建一条，指向失败的那条。
    const retry = existing !== null && existing.status === 'failed'
    const created = existing === null || retry
    const assignment = created
      ? createAssignment({
        store,
        id: retry ? `${deliveryKey}-${randomUUID().slice(0, 8)}` : deliveryKey,
        roomId,
        stageIndex: index,
        fromMemberId: from,
        toMemberId: to,
        reason,
        brief: {
          stageTitle: stage?.title ?? '',
          kind: stage?.kind ?? '',
          goal: current.goal ?? '',
          done: Array.isArray(current.plan?.done) ? current.plan.done.slice(0, 6) : [],
          constraints: Array.isArray(current.constraints) ? current.constraints.slice(0, 6) : [],
          acceptance: acceptance ?? stage?.acceptance ?? '',
          prompt: body,
        },
        context: {
          ...context,
          ...(candidate === null ? {} : { candidate }),
          ...(evidence?.id === undefined ? {} : { evidenceId: evidence.id }),
          ...(verdict?.id === undefined ? {} : { verdictId: verdict.id }),
        },
        evidenceIds: evidence?.id === undefined ? [] : [evidence.id],
        parentAssignmentId: retry ? existing.id : parentAssignmentId,
        status: 'created',
      })
      : existing
    const sendId = assignment.id
    const stored = visible === false ? null : store.appendMessage(roomId, {
      kind: 'handoff',
      authorId: from,
      text: summary,
      meta: { assignmentId: assignment.id, stage: index, status: 'sending' },
    })
    if (created) {
      store.appendEvent(roomId, 'assignment.created', {
        assignmentId: assignment.id,
        stage: index,
        from,
        to,
        reason,
        messageId: stored?.id,
      })
    }
    // 规划师已经在群里 @ 了对方，基座会负责叫醒；这里只记账，不再重复投递。
    if (deliver === false) {
      const sent = transitionAssignment(store, assignment.id, 'sent', {
        sendId,
        messageId: stored?.id,
        sentAt: Date.now(),
      })
      store.appendEvent(roomId, 'assignment.sent', {
        assignmentId: assignment.id,
        stage: index,
        from,
        to,
        reason,
        messageId: stored?.id,
      })
      return sent ?? assignment
    }
    try {
      await sendToMember(to, body, {
        intent: reason === 'review' ? 'review' : 'handoff',
        from,
        sendId,
        ...(privateRoom === true ? { privateRoom: true } : {}),
      })
      const sent = transitionAssignment(store, assignment.id, 'sent', {
        sendId,
        messageId: stored?.id,
        sentAt: Date.now(),
      })
      if (stored !== null) {
        store.upsertMessage?.({
          ...stored,
          meta: { ...stored.meta, status: 'sent', sentAt: Date.now() },
        })
      }
      store.appendEvent(roomId, 'assignment.sent', {
        assignmentId: assignment.id,
        stage: index,
        from,
        to,
        reason,
        messageId: stored?.id,
      })
      return sent ?? assignment
    } catch (error) {
      transitionAssignment(store, assignment.id, 'failed', {
        messageId: stored?.id,
        resultText: String(error?.message ?? error),
      })
      if (stored !== null) {
        store.upsertMessage?.({
          ...stored,
          meta: { ...stored.meta, status: 'failed', error: String(error?.message ?? error) },
        })
      }
      store.appendEvent(roomId, 'assignment.failed', {
        assignmentId: assignment.id,
        stage: index,
        from,
        to,
        reason,
        messageId: stored?.id,
        error: String(error?.message ?? error),
      })
      throw error
    }
  }

  return { trigger }
}
