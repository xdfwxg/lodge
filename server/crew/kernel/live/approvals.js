import { randomUUID } from 'node:crypto'
import { externalAction, pendingApprovals } from '../../external-actions.js'
import { reviewExternalAction } from './action-gate.js'
import { memberNameOf } from './projection.js'
import { memberOf } from '../../room-members.js'
import { decidePermission } from '../../permission.js'
import { supportsRuntime } from '../../runtime-port.js'

const APPROVAL_TIMEOUT = 10 * 60 * 1000
const ANSWERED_KEEP = 500
const PENDING_LIMIT = 50

// 已回答的卡只用于去重，保留最近一批即可；待确认的卡不能丢，它们还在基座里等人。
const rememberAnswer = (entry, requestId) => {
  entry.answeredCards.add(requestId)
  while (entry.answeredCards.size > ANSWERED_KEEP) {
    entry.answeredCards.delete(entry.answeredCards.values().next().value)
  }
}

export const createLiveApprovals = ({
  store,
  engine,
  emit,
  approvalTimeoutMs = APPROVAL_TIMEOUT,
  readOnlyFor = () => false,
}) => {
  const setApprovalState = (roomId, approvalId, state, extra = {}) => store.updateRoom(roomId, current => {
    const approval = current.approvals?.find(item => item?.id === approvalId && item.state === 'pending')
    if (approval === undefined) return null
    approval.state = state
    approval.decidedAt = Date.now()
    Object.assign(approval, extra)
    return {
      events: [{
        type: `approval.${state}`,
        payload: { id: approvalId, memberId: approval.memberId, kind: approval.kind, requestId: approval.requestId },
      }],
    }
  })

  const clearTimer = (entry, approvalId) => {
    const timer = entry?.approvalTimers?.get(approvalId)
    if (timer === undefined) return
    clearTimeout(timer)
    entry.approvalTimers.delete(approvalId)
  }

  const clearTimers = entry => {
    for (const timer of entry?.approvalTimers?.values() ?? []) clearTimeout(timer)
    entry?.approvalTimers?.clear()
  }

  // 确认超时只暂停房间，不替人做决定；基座仍在等这张卡，所以处理后可以原地恢复。
  const resumeRoom = (roomId, text) => {
    const updated = store.updateRoom(roomId, current => {
      if (current.state !== 'paused' || current.pauseReason !== 'approval') return null
      current.state = 'active'
      current.pauseReason = null
      current.idle = false
      return { events: [{ type: 'room.state', payload: { state: 'active', action: 'approval' } }] }
    })
    if (updated === null) return null
    store.appendMessage(roomId, { kind: 'system', text })
    emit('room', updated)
    return updated
  }

  // 外部动作默认由人批准；只有显式 auto 信任，且规则守门明确 allow 时才自动放行。
  const holdForApproval = async (entry, memberId, card, external, sessionRef) => {
    const room = store.readRoom(entry.roomId)
    if (room === null) return
    if (pendingApprovals(room).length >= PENDING_LIMIT) {
      rememberAnswer(entry, card.requestId)
      if (typeof sessionRef === 'string' && sessionRef !== '') {
        await engine.answerCard({ sessionRef, requestId: card.requestId, behavior: 'deny' }).catch(() => {})
      }
      store.appendMessage(entry.roomId, {
        kind: 'system',
        text: `待确认的操作已经有 ${PENDING_LIMIT} 个，这次先拒绝；处理完再继续。`,
      })
      return
    }
    const approval = {
      id: randomUUID(),
      memberId,
      memberName: memberNameOf(room, memberId),
      requestId: card.requestId,
      ...(typeof sessionRef === 'string' && sessionRef !== '' ? { sessionRef } : {}),
      tool: typeof card.tool === 'string' ? card.tool : '',
      kind: external.kind,
      label: external.label,
      summary: external.summary,
      ...(typeof external.command === 'string' && external.command !== '' ? { command: external.command } : {}),
      state: 'pending',
      at: Date.now(),
    }
    approval.gate = reviewExternalAction({ approval, room })
    const updated = store.updateRoom(entry.roomId, current => {
      const existing = current.approvals ?? []
      // pending 不能被历史截断：截掉的卡在基座还在等，但人已经看不到。
      current.approvals = [
        ...existing.filter(item => item?.state === 'pending'),
        ...existing.filter(item => item?.state !== 'pending').slice(-20),
        approval,
      ]
      return {
        events: [{
          type: 'approval.requested',
          payload: { id: approval.id, memberId, kind: approval.kind, summary: approval.summary },
        }],
      }
    })
    if (updated === null) return
    entry.heldCards.set(card.requestId, approval.id)
    store.appendMessage(entry.roomId, {
      kind: 'system',
      text: `有个操作要你确认：${approval.memberName} · ${approval.label} · ${approval.summary}`,
      meta: { kind: 'approval', approvalId: approval.id },
    })
    emit('room', updated)
    const timer = setTimeout(() => {
      entry.approvalTimers.delete(approval.id)
      const current = store.readRoom(entry.roomId)
      if (current === null || current.state !== 'active') return
      if (!pendingApprovals(current).some(item => item.id === approval.id)) return
      const paused = store.updateRoom(entry.roomId, room => {
        if (room.state !== 'active') return null
        room.state = 'paused'
        room.pauseReason = 'approval'
        room.idle = false
        return {
          events: [{
            type: 'approval.timeout',
            payload: { id: approval.id, memberId, kind: approval.kind },
          }],
        }
      })
      if (paused === null) return
      store.appendMessage(entry.roomId, {
        kind: 'system',
        text: '这个操作等太久了，房间已暂停；确认后继续。',
      })
      emit('room', paused)
    }, approvalTimeoutMs)
    timer.unref?.()
    entry.approvalTimers.set(approval.id, timer)
  }

  const expireApprovals = (entry, roomId, reason) => {
    clearTimers(entry)
    const room = store.readRoom(roomId)
    const pending = pendingApprovals(room)
    if (pending.length === 0) return null
    for (const approval of pending) {
      entry?.heldCards.delete(approval.requestId)
      const target = entry?.members.get(approval.memberId)
      const sessionRef = approval.sessionRef ?? target?.sessionRef
      if (typeof sessionRef === 'string' && sessionRef !== '') {
        // 本地卡作废时也告诉基座，否则它会一直等一个永远不会来的回答。
        void engine.answerCard({
          sessionRef,
          requestId: approval.requestId,
          behavior: 'deny',
        }).catch(() => {})
      }
    }
    const updated = store.updateRoom(roomId, current => {
      const now = Date.now()
      for (const approval of current.approvals ?? []) {
        if (approval?.state !== 'pending') continue
        approval.state = 'expired'
        approval.decidedAt = now
      }
      return {
        events: [{
          type: 'approval.expired',
          payload: { ids: pending.map(item => item.id), reason },
        }],
      }
    })
    if (updated === null) return null
    store.appendMessage(roomId, {
      kind: 'system',
      text: `这个操作已经过期：${reason}。`,
    })
    emit('room', updated)
    return updated
  }

  const answerPermission = async (entry, memberId, message, refresh, { sessionRef } = {}) => {
    if (!supportsRuntime(engine, 'approvals')) return
    const card = message?.card
    if (card?.requestType !== 'permission' || typeof card.requestId !== 'string') return
    if (entry.answeredCards.has(card.requestId) || entry.heldCards.has(card.requestId)) return
    const room = store.readRoom(entry.roomId)
    const member = memberOf(room, memberId)
    const readOnly = readOnlyFor(room)
    const directVerifier = room?.workspace?.provider === 'direct' &&
      (member?.role === 'verifier' || member?.roleKind === 'verifier')
    const allowed = decidePermission(member, card.action, { readOnly, direct: room?.workspace?.provider === 'direct' })
    const external = allowed ? externalAction(card) : null
    const cardSession = sessionRef ?? entry.members.get(memberId)?.sessionRef
    if (external !== null) {
      await holdForApproval(entry, memberId, card, external, cardSession)
      return
    }
    rememberAnswer(entry, card.requestId)
    try {
      const result = await engine.answerCard({
        sessionRef: cardSession,
        requestId: card.requestId,
        behavior: allowed ? 'allow' : 'deny',
      })
      if (result?.ok === false) throw new Error(result.error ?? '房间没接受这次确认')
      if (!allowed) {
        const blockedByReadOnly = readOnly && (card.action === 'write' || card.action === 'exec')
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: directVerifier
            ? `原地目录没有独立复核副本：${member?.name ?? memberId} 只能读，不能使用 ${card.tool ?? card.action}；要跑命令请改用 git 或复制工作区。`
            : blockedByReadOnly
              ? `只读讨论阶段：${member?.name ?? memberId} 不能使用 ${card.tool ?? card.action}；先讨论，结论定了再改文件。`
              : `权限拒绝：${member?.name ?? memberId} 不能使用 ${card.tool ?? card.action ?? '该工具'}。`,
        })
      }
      refresh(entry, { force: true })
    } catch (error) {
      entry.answeredCards.delete(card.requestId)
      store.appendMessage(entry.roomId, { kind: 'system', text: `权限卡处理失败：${error?.message ?? error}` })
    }
  }

  const answerCard = async ({ entry, roomId, memberId, requestId, message, refresh }) => {
    if (!supportsRuntime(engine, 'approvals')) return { ok: false, reason: '当前版本还不支持回答问题' }
    if (entry === undefined) return { ok: false, reason: '房间还没有连上' }
    if (typeof requestId !== 'string' || requestId === '') return { ok: false, reason: '缺少要回答的问题' }
    const text = typeof message === 'string' ? message.trim() : ''
    if (text === '') return { ok: false, reason: '先写下答案' }
    if (entry.answeredCards.has(requestId)) return { ok: false, reason: '这个问题已经回答过' }
    const room = store.readRoom(roomId)
    const target = entry.members.get(memberId)
    const sessionRef = target?.sessionRef ?? room?.chatRoom?.sessionRef
    try {
      const result = await engine.answerCard({ sessionRef, requestId, behavior: 'answer', message: text })
      if (result?.ok === false) throw new Error(result.error ?? '基座没有接受这个回答')
      rememberAnswer(entry, requestId)
      store.appendMessage(roomId, {
        kind: 'system',
        text: `已回答${memberNameOf(room, memberId)}的问题。`,
      })
      refresh(entry, { force: true })
      return { ok: true, room: store.readRoom(roomId) }
    } catch (error) {
      return { ok: false, reason: String(error?.message ?? error) }
    }
  }

  const decideApproval = async ({ entry, roomId, approvalId, decision, refresh }) => {
    if (!supportsRuntime(engine, 'approvals')) return { ok: false, reason: '当前版本还不支持操作确认' }
    if (!['allow', 'deny'].includes(decision)) return { ok: false, reason: '这个操作只能选“可以做”或“先别做”' }
    if (entry === undefined) return { ok: false, reason: '房间还没有连上' }
    const room = store.readRoom(roomId)
    const approval = pendingApprovals(room).find(item => item.id === approvalId)
    if (approval === undefined) return { ok: false, reason: '没有待确认的操作' }
    if (entry.heldCards.get(approval.requestId) !== approvalId) {
      const expired = setApprovalState(roomId, approvalId, 'expired')
      store.appendMessage(roomId, { kind: 'system', text: `这个操作已经失效：${approval.summary}` })
      if (expired !== null) emit('room', expired)
      resumeRoom(roomId, '这个操作已经失效，房间已恢复。')
      return { ok: false, reason: '这个操作已经失效，房间没在等这次确认' }
    }
    const target = entry.members.get(approval.memberId)
    if (target === undefined) {
      clearTimer(entry, approvalId)
      entry.heldCards.delete(approval.requestId)
      const expired = setApprovalState(roomId, approvalId, 'expired')
      store.appendMessage(roomId, {
        kind: 'system',
        text: `这个操作失效了：${approval.summary}（${approval.memberName} 已不在房间）`,
      })
      if (expired !== null) emit('room', expired)
      resumeRoom(roomId, '要确认的成员已经不在房间，房间已恢复。')
      return { ok: false, reason: `要确认的成员 ${approval.memberName} 已不在房间` }
    }
    clearTimer(entry, approvalId)
    try {
      const result = await engine.answerCard({
        sessionRef: approval.sessionRef ?? target.sessionRef,
        requestId: approval.requestId,
        behavior: decision,
      })
      if (result?.ok === false) throw new Error(result.error ?? '房间没接受这次确认')
    } catch (error) {
      entry.heldCards.delete(approval.requestId)
      const expired = setApprovalState(roomId, approvalId, 'expired')
      store.appendMessage(roomId, {
        kind: 'system',
        text: `这个操作已经失效：${approval.summary}（${error?.message ?? error}）`,
      })
      if (expired !== null) emit('room', expired)
      resumeRoom(roomId, '这个操作已经失效，房间已恢复；可以继续，或重新发起。')
      return { ok: false, reason: `房间已经不在等这次确认：${error?.message ?? error}` }
    }
    entry.heldCards.delete(approval.requestId)
    rememberAnswer(entry, approval.requestId)
    const state = decision === 'allow' ? 'allowed' : 'denied'
    const updated = setApprovalState(roomId, approvalId, state)
    store.appendMessage(roomId, {
      kind: 'system',
      text: `这个操作你已选${decision === 'allow' ? '可以做' : '先别做'}：${approval.memberName} · ${approval.summary}`,
    })
    if (updated !== null) emit('room', updated)
    resumeRoom(roomId, '审批已处理，房间继续。')
    refresh(entry, { force: true })
    return { ok: true, room: updated ?? store.readRoom(roomId) }
  }

  const resumeApprovalPauseIfSettled = roomId => {
    const room = store.readRoom(roomId)
    if (room?.state !== 'paused' || room.pauseReason !== 'approval') return null
    if (pendingApprovals(room).length > 0) return null
    return resumeRoom(roomId, '审批在重启后失效，房间已恢复。')
  }

  return {
    expireApprovals,
    answerPermission,
    answerCard,
    decideApproval,
    resumeApprovalPauseIfSettled,
  }
}
