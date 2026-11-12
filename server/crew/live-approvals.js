import { randomUUID } from 'node:crypto'
import { externalAction, pendingApprovals } from './external-actions.js'
import { reviewExternalAction } from './gate.js'
import { seatNameOf } from './live-projection.js'
import { decidePermission } from './permission.js'

export const createLiveApprovals = ({ store, engine, emit, gateAgent = null }) => {
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

  // 外部动作不共享席位的自动判定：先落成房间里的待批准记录，人点了才回答基座权限卡。
  const holdForApproval = (entry, seat, card, external) => {
    const room = store.readRoom(entry.roomId)
    if (room === null) return
    const approval = {
      id: randomUUID(),
      seat,
      seatName: seatNameOf(room, seat),
      requestId: card.requestId,
      tool: typeof card.tool === 'string' ? card.tool : '',
      kind: external.kind,
      label: external.label,
      summary: external.summary,
      state: 'pending',
      at: Date.now(),
    }
    approval.gate = reviewExternalAction({ approval, room })
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

  const answerPermission = async (entry, seat, message, refresh) => {
    const card = message?.card
    if (card?.requestType !== 'permission' || typeof card.requestId !== 'string') return
    if (entry.answeredCards.has(card.requestId) || entry.heldCards.has(card.requestId)) return
    const room = store.readRoom(entry.roomId)
    const spec = room?.seatSpecs?.find(item => item.id === seat)
    const allowed = decidePermission(spec, card.action)
    const external = allowed ? externalAction(card) : null
    if (external !== null) {
      holdForApproval(entry, seat, card, external)
      return
    }
    entry.answeredCards.add(card.requestId)
    try {
      const result = await engine.answerCard({
        sessionRef: entry.seats.get(seat)?.sessionRef,
        requestId: card.requestId,
        behavior: allowed ? 'allow' : 'deny',
      })
      if (result?.ok === false) throw new Error(result.error ?? '基座拒绝了权限卡答案')
      if (!allowed) {
        store.appendMessage(entry.roomId, {
          kind: 'system',
          text: `权限拒绝：${spec?.name ?? seat} 不能使用 ${card.tool ?? card.action ?? '该工具'}。`,
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
    if (target === undefined) return { ok: false, reason: `审批对应的席位 ${approval.seatName} 已不在房间` }
    try {
      const result = await engine.answerCard({
        sessionRef: target.sessionRef,
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
    refresh(entry, { force: true })
    return { ok: true, room: updated ?? store.readRoom(roomId) }
  }

  return { expireApprovals, answerPermission, decideApproval }
}
