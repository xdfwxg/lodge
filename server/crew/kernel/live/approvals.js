import { randomUUID } from 'node:crypto'
import { externalAction, pendingApprovals } from '../../external-actions.js'
import { reviewExternalAction } from './action-gate.js'
import { memberNameOf } from './projection.js'
import { memberOf } from '../../room-members.js'
import { systemNotice } from '../../notices.js'
import { decidePermission } from '../../permission.js'
import { supportsRuntime } from '../../runtime-port.js'
import { attemptScopeOf, scopeIsValid } from '../../../../shared/attempt.js'
import { canSkipApproval } from '../../room-access.js'
import { appendHumanContext } from '../../human-context.js'

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

const markRoomAnswer = (store, roomId, requestId) => {
  store.updateRoom(roomId, current => {
    const answers = Array.isArray(current.cardAnswers) ? current.cardAnswers : []
    if (answers.includes(requestId)) return null
    current.cardAnswers = [...answers, requestId].slice(-200)
    return { events: [] }
  })
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
    store.cancelTimer?.(approvalId)
    const timer = entry?.approvalTimers?.get(approvalId)
    if (timer === undefined) return
    clearTimeout(timer)
    entry.approvalTimers.delete(approvalId)
  }

  const clearTimers = entry => {
    for (const approvalId of entry?.approvalTimers?.keys() ?? []) store.cancelTimer?.(approvalId)
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

  // 另一张卡把房间暂停时，先等它恢复；否则这张卡的计时会永久丢失。
  const armApprovalTimer = (entry, approval) => {
    const tick = () => {
      entry.approvalTimers.delete(approval.id)
      const current = store.readRoom(entry.roomId)
      if (current === null) return
      if (!pendingApprovals(current).some(item => item.id === approval.id)) return
      if (current.state !== 'active') {
        if (current.state === 'paused' && current.pauseReason === 'approval') {
          const timer = setTimeout(tick, Math.min(30_000, approvalTimeoutMs))
          timer.unref?.()
          entry.approvalTimers.set(approval.id, timer)
        }
        return
      }
      const paused = store.updateRoom(entry.roomId, room => {
        if (room.state !== 'active') return null
        room.state = 'paused'
        room.pauseReason = 'approval'
        room.idle = false
        return {
          events: [{
            type: 'approval.timeout',
            payload: { id: approval.id, memberId: approval.memberId, kind: approval.kind },
          }],
        }
      })
      if (paused === null) return
      store.appendMessage(entry.roomId, {
        kind: 'system',
        text: '这个操作等太久了，房间已暂停；确认后继续。',
      })
      emit('room', paused)
    }
    const timer = setTimeout(tick, approvalTimeoutMs)
    timer.unref?.()
    entry.approvalTimers.set(approval.id, timer)
    // 进程重启后靠这份持久 timer 找回；正常路径仍由上面的内存计时器先处理。
    store.setTimer?.({
      id: approval.id,
      roomId: entry.roomId,
      kind: 'approval',
      dueAt: Date.now() + approvalTimeoutMs,
      payload: { approvalId: approval.id },
    })
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
      scope: attemptScopeOf({
        room,
        messages: store.readMessages?.(entry.roomId) ?? [],
        memberId,
      }),
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
    armApprovalTimer(entry, approval)
  }

  const expireApprovals = async (entry, roomId, reason) => {
    clearTimers(entry)
    const room = store.readRoom(roomId)
    const pending = pendingApprovals(room)
    if (pending.length === 0) return null
    const expired = []
    for (const approval of pending) {
      const target = entry?.members.get(approval.memberId)
      const sessionRef = approval.sessionRef ?? target?.sessionRef
      if (typeof sessionRef === 'string' && sessionRef !== '') {
        try {
          const result = await engine.answerCard({
            sessionRef,
            requestId: approval.requestId,
            behavior: 'deny',
          })
          if (result?.ok === false) throw new Error(result.error ?? 'Lodge 服务没有接受这次拒绝')
        } catch {
          // 基座还没收到拒绝就把本地卡留着；重连时还有机会再送一次。
          continue
        }
      }
      entry?.heldCards.delete(approval.requestId)
      expired.push(approval)
    }
    if (expired.length === 0) return null
    const ids = new Set(expired.map(item => item.id))
    const updated = store.updateRoom(roomId, current => {
      const now = Date.now()
      for (const approval of current.approvals ?? []) {
        if (approval?.state !== 'pending' || !ids.has(approval.id)) continue
        approval.state = 'expired'
        approval.decidedAt = now
      }
      return {
        events: [{
          type: 'approval.expired',
          payload: { ids: [...ids], reason },
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
    // 系统只放行只读研究；其他外部动作照旧逐次确认。
    const browserAllowed = allowed && canSkipApproval({ member, tool: card.tool })
    if (external !== null && !browserAllowed) {
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
      markRoomAnswer(store, entry.roomId, card.requestId)
      if (!allowed) {
        const blockedByReadOnly = readOnly && (card.action === 'write' || card.action === 'exec')
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: directVerifier
            ? `原地目录的验收员只能读，不能使用 ${card.tool ?? card.action}；要跑命令请改用 git 或复制工作区。`
            : blockedByReadOnly
              ? `只读讨论阶段：${member?.name ?? memberId} 不能使用 ${card.tool ?? card.action}；先讨论，结论定了再改文件。`
              : `权限拒绝：${member?.name ?? memberId} 不能使用 ${card.tool ?? card.action ?? '该工具'}。`,
        })
      }
      refresh(entry, { force: true })
    } catch (error) {
      entry.answeredCards.delete(card.requestId)
      const reason = String(error?.message ?? error)
      // 基座已经不在等这张卡（例如重启后重放历史）：本地收起来，别让人对着一张死卡。
      if (/nothing is waiting/i.test(reason)) {
        markRoomAnswer(store, entry.roomId, card.requestId)
        refresh(entry, { force: true })
        return
      }
      systemNotice({ store, roomId: entry.roomId, text: '有一步确认没能处理；待处理。', error })
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
    const messages = store.readMessages?.(roomId) ?? []
    const card = messages.find(message => (
      message.kind === 'question' && message.meta?.card?.requestId === requestId
    ))
    if (card !== undefined && !scopeIsValid(card.meta.card.scope, { room, messages })) {
      return { ok: false, reason: '这张问题已经过期；这一步已经结束或重开过了' }
    }
    const target = entry.members.get(memberId)
    const sessionRef = target?.sessionRef ?? room?.chatRoom?.sessionRef
    try {
      const result = await engine.answerCard({ sessionRef, requestId, behavior: 'answer', message: text })
      if (result?.ok === false) throw new Error(result.error ?? 'Lodge 服务没有接受这个回答')
      rememberAnswer(entry, requestId)
      markRoomAnswer(store, roomId, requestId)
      appendHumanContext({
        store,
        roomId,
        stage: Number.isInteger(card?.meta?.card?.scope?.stage) ? card.meta.card.scope.stage : null,
        text,
        source: 'answer',
      })
      store.appendMessage(roomId, {
        kind: 'system',
        text: `已回答${memberNameOf(room, memberId)}的问题。`,
        meta: { kind: 'card-answered', requestId },
      })
      refresh(entry, { force: true })
      return { ok: true, room: store.readRoom(roomId) }
    } catch (error) {
      const reason = String(error?.message ?? error)
      // 基座那边已经不在等这张卡（例如房间重启过）：本地视为回答过，别让人对着死卡点。
      if (/nothing is waiting/i.test(reason)) {
        rememberAnswer(entry, requestId)
        store.appendMessage(roomId, {
          kind: 'system',
          text: '这张问题已经不在等待，自动收起了。',
          meta: { kind: 'card-answered', requestId },
        })
        refresh(entry, { force: true })
        return { ok: true, room: store.readRoom(roomId) }
      }
      return { ok: false, reason }
    }
  }

  const decideApprovalNow = async ({ entry, roomId, approvalId, decision, refresh }) => {
    if (!supportsRuntime(engine, 'approvals')) return { ok: false, reason: '当前版本还不支持操作确认' }
    if (!['allow', 'deny'].includes(decision)) return { ok: false, reason: '这个操作只能选“可以做”或“先别做”' }
    if (entry === undefined) return { ok: false, reason: '房间还没有连上' }
    const room = store.readRoom(roomId)
    const approval = pendingApprovals(room).find(item => item.id === approvalId)
    if (approval === undefined) return { ok: false, reason: '没有待确认的操作' }
    if (!scopeIsValid(approval.scope, { room, messages: store.readMessages?.(roomId) ?? [] })) {
      await expireApprovals(entry, roomId, '这一步已经变了')
      resumeRoom(roomId, '待确认的操作已过期，房间已恢复。')
      return { ok: false, reason: '这个操作已经过期；这一步已经结束或重开过了' }
    }
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
        text: `这个操作已经失效：${approval.summary}。请重新发起。`,
      })
      if (expired !== null) emit('room', expired)
      resumeRoom(roomId, '这个操作已经失效，房间已恢复；可以继续，或重新发起。')
      return { ok: false, reason: '房间已经不在等这次确认；请重新发起。' }
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
    resumeRoom(roomId, '外部操作已确认，房间继续。')
    refresh(entry, { force: true })
    return { ok: true, room: updated ?? store.readRoom(roomId) }
  }

  // 双击或两个客户端同时点，只让第一次真正回答基座。
  const decideApproval = async args => {
    const { entry, approvalId } = args
    if (entry === undefined) return { ok: false, reason: '房间还没有连上' }
    entry.deciding ??= new Set()
    if (entry.deciding.has(approvalId)) return { ok: false, reason: '这个操作正在处理' }
    entry.deciding.add(approvalId)
    try {
      return await decideApprovalNow(args)
    } finally {
      entry.deciding.delete(approvalId)
    }
  }

  const resumeApprovalPauseIfSettled = roomId => {
    const room = store.readRoom(roomId)
    if (room?.state !== 'paused' || room.pauseReason !== 'approval') return null
    if (pendingApprovals(room).length > 0) return null
    return resumeRoom(roomId, '外部操作确认在重启后失效，房间已恢复。')
  }

  return {
    expireApprovals,
    answerPermission,
    answerCard,
    decideApproval,
    resumeApprovalPauseIfSettled,
  }
}
