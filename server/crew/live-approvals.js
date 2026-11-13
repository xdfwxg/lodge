import { randomUUID } from 'node:crypto'
import { externalAction, pendingApprovals } from './external-actions.js'
import { reviewExternalAction } from './gate.js'
import { seatNameOf } from './live-projection.js'
import { activeStageReadOnly } from './live-turn-utils.js'
import { decidePermission } from './permission.js'
import { trustLevelOf } from './trust.js'

export const APPROVAL_TIMEOUT = 10 * 60 * 1000

export const createLiveApprovals = ({ store, engine, emit, gateAgent = null, approvalTimeoutMs = APPROVAL_TIMEOUT }) => {
  const setApprovalState = (roomId, approvalId, state, extra = {}) => store.updateRoom(roomId, current => {
    const approval = current.approvals?.find(item => item?.id === approvalId && item.state === 'pending')
    if (approval === undefined) return null
    approval.state = state
    approval.decidedAt = Date.now()
    Object.assign(approval, extra)
    return {
      events: [{
        type: `approval.${state}`,
        payload: { id: approvalId, seat: approval.seat, kind: approval.kind, requestId: approval.requestId },
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

  // 审批超时只暂停房间，不替人做决定；基座仍在等这张卡，所以处理后可以原地恢复。
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
  const holdForApproval = async (entry, seat, card, external, sessionRef) => {
    const room = store.readRoom(entry.roomId)
    if (room === null) return
    const approval = {
      id: randomUUID(),
      seat,
      seatName: seatNameOf(room, seat),
      requestId: card.requestId,
      ...(typeof sessionRef === 'string' && sessionRef !== '' ? { sessionRef } : {}),
      tool: typeof card.tool === 'string' ? card.tool : '',
      kind: external.kind,
      label: external.label,
      summary: external.summary,
      state: 'pending',
      at: Date.now(),
    }
    approval.gate = reviewExternalAction({ approval, room })
    if (trustLevelOf(room) === 'auto' && approval.gate.decision === 'allow') {
      entry.answeredCards.add(card.requestId)
      try {
        const result = await engine.answerCard({
          sessionRef: sessionRef ?? entry.seats.get(seat)?.sessionRef,
          requestId: card.requestId,
          behavior: 'allow',
        })
        if (result?.ok === false) throw new Error(result.error ?? '基座拒绝了自动放行')
        store.appendEvent(entry.roomId, 'trust.auto_allow', {
          seat,
          kind: approval.kind,
          summary: approval.summary,
        })
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: `信任级别 auto：${approval.seatName} 的外部动作已自动放行（规则守门 allow）。`,
        })
        emit('room', store.readRoom(entry.roomId))
        return
      } catch (error) {
        entry.answeredCards.delete(card.requestId)
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: `自动放行失败，改为等你批准：${error?.message ?? error}`,
        })
      }
    }
    const updated = store.updateRoom(entry.roomId, current => {
      current.approvals = [...(current.approvals ?? []), approval].slice(-20)
      return {
        events: [{
          type: 'approval.requested',
          payload: { id: approval.id, seat, kind: approval.kind, summary: approval.summary },
        }],
      }
    })
    if (updated === null) return
    entry.heldCards.set(card.requestId, approval.id)
    store.appendMessage(entry.roomId, {
      kind: 'system',
      text: `外部动作等你批准：${approval.seatName} · ${approval.label} · ${approval.summary}`,
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
            payload: { id: approval.id, seat, kind: approval.kind },
          }],
        }
      })
      if (paused === null) return
      store.appendMessage(entry.roomId, {
        kind: 'system',
        text: '外部动作审批超时无人处理，房间已暂停；批准或拒绝后继续。',
      })
      emit('room', paused)
    }, approvalTimeoutMs)
    timer.unref?.()
    entry.approvalTimers.set(approval.id, timer)
    if (gateAgent !== null && typeof gateAgent.review === 'function') {
      void gateAgent.review({ room, approval }).then(result => {
        if (result === null || result === undefined) return
        const next = store.updateRoom(entry.roomId, current => {
          const item = current.approvals?.find(approvalItem => approvalItem.id === approval.id && approvalItem.state === 'pending')
          if (item === undefined) return null
          item.gateAgent = result
          return { events: [{ type: 'approval.gate_agent', payload: { id: approval.id, decision: result.decision } }] }
        })
        if (next !== null) emit('room', next)
      }).catch(error => {
        console.warn(`gate agent failed: ${approval.id} ${error?.message ?? error}`)
      })
    }
  }

  const expireApprovals = (entry, roomId, reason) => {
    clearTimers(entry)
    const room = store.readRoom(roomId)
    const pending = pendingApprovals(room)
    if (pending.length === 0) return null
    for (const approval of pending) entry?.heldCards.delete(approval.requestId)
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
      text: `待批准的外部动作已失效：${reason}。`,
    })
    emit('room', updated)
    return updated
  }

  const answerPermission = async (entry, seat, message, refresh, { sessionRef } = {}) => {
    const card = message?.card
    if (card?.requestType !== 'permission' || typeof card.requestId !== 'string') return
    if (entry.answeredCards.has(card.requestId) || entry.heldCards.has(card.requestId)) return
    const room = store.readRoom(entry.roomId)
    const spec = room?.seatSpecs?.find(item => item.id === seat)
    const observe = trustLevelOf(room) === 'observe'
    const readOnly = activeStageReadOnly(room) || observe
    const allowed = decidePermission(spec, card.action, { readOnly })
    const external = allowed ? externalAction(card) : null
    const cardSession = sessionRef ?? entry.seats.get(seat)?.sessionRef
    if (external !== null) {
      await holdForApproval(entry, seat, card, external, cardSession)
      return
    }
    entry.answeredCards.add(card.requestId)
    try {
      const result = await engine.answerCard({
        sessionRef: cardSession,
        requestId: card.requestId,
        behavior: allowed ? 'allow' : 'deny',
      })
      if (result?.ok === false) throw new Error(result.error ?? '基座拒绝了权限卡答案')
      if (!allowed) {
        const blockedByReadOnly = readOnly && (card.action === 'write' || card.action === 'exec')
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: observe && blockedByReadOnly
            ? `信任级别 observe：${spec?.name ?? seat} 只读；提升到 verify 后才能使用 ${card.tool ?? card.action}。`
            : blockedByReadOnly
              ? `只读讨论阶段：${spec?.name ?? seat} 不能使用 ${card.tool ?? card.action}；先讨论，结论确认后再改文件。`
              : `权限拒绝：${spec?.name ?? seat} 不能使用 ${card.tool ?? card.action ?? '该工具'}。`,
        })
      }
      refresh(entry, { force: true })
    } catch (error) {
      entry.answeredCards.delete(card.requestId)
      store.appendMessage(entry.roomId, { kind: 'system', text: `权限卡处理失败：${error?.message ?? error}` })
    }
  }

  const decideApproval = async ({ entry, roomId, approvalId, decision, refresh }) => {
    if (!['allow', 'deny'].includes(decision)) return { ok: false, reason: '审批只接受 allow/deny' }
    if (entry === undefined) return { ok: false, reason: '实时房间未绑定' }
    const room = store.readRoom(roomId)
    const approval = pendingApprovals(room).find(item => item.id === approvalId)
    if (approval === undefined) return { ok: false, reason: '没有待批准的审批' }
    if (entry.heldCards.get(approval.requestId) !== approvalId) {
      return { ok: false, reason: '审批已失效，基座权限卡不在等待' }
    }
    const target = entry.seats.get(approval.seat)
    if (target === undefined) {
      clearTimer(entry, approvalId)
      entry.heldCards.delete(approval.requestId)
      const expired = setApprovalState(roomId, approvalId, 'expired')
      store.appendMessage(roomId, {
        kind: 'system',
        text: `外部动作审批失效：${approval.summary}（席位 ${approval.seatName} 已不在房间）`,
      })
      if (expired !== null) emit('room', expired)
      resumeRoom(roomId, '审批对应的席位已移除，房间已恢复。')
      return { ok: false, reason: `审批对应的席位 ${approval.seatName} 已不在房间` }
    }
    clearTimer(entry, approvalId)
    try {
      const result = await engine.answerCard({
        sessionRef: approval.sessionRef ?? target.sessionRef,
        requestId: approval.requestId,
        behavior: decision,
      })
      if (result?.ok === false) throw new Error(result.error ?? '基座拒绝了权限卡答案')
    } catch (error) {
      entry.heldCards.delete(approval.requestId)
      const expired = setApprovalState(roomId, approvalId, 'expired')
      store.appendMessage(roomId, {
        kind: 'system',
        text: `外部动作审批失效：${approval.summary}（${error?.message ?? error}）`,
      })
      if (expired !== null) emit('room', expired)
      resumeRoom(roomId, '审批已失效，房间已恢复；可继续或重新发起。')
      return { ok: false, reason: `基座权限卡已不在等待：${error?.message ?? error}` }
    }
    entry.heldCards.delete(approval.requestId)
    entry.answeredCards.add(approval.requestId)
    const state = decision === 'allow' ? 'allowed' : 'denied'
    const updated = setApprovalState(roomId, approvalId, state)
    store.appendMessage(roomId, {
      kind: 'system',
      text: `外部动作已${decision === 'allow' ? '允许' : '拒绝'}：${approval.seatName} · ${approval.summary}`,
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
    decideApproval,
    resumeApprovalPauseIfSettled,
  }
}
