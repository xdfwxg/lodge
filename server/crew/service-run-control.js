import { budgetHint, budgetStatus } from './budget.js'
import { resetMcpBreakers } from './mcp-breaker.js'
import { fail, ok } from './result.js'
import { writeGoal } from './room-repo.js'

export const createServiceRunControl = ({ store, live, emit, dispatchPayload }) => {
  const { readRoom, readRooms, readMessages, updateRoom, appendMessage } = store

  const resetMcp = (roomId, body) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.imported === true) return fail('conflict', '交接记录只读')
    const server = typeof body?.server === 'string' && body.server !== '' ? body.server : null
    const updated = updateRoom(roomId, current => {
      current.mcpBreakers = resetMcpBreakers(current.mcpBreakers, server)
      return { events: [{ type: 'mcp.reset', payload: { server } }] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    appendMessage(roomId, {
      kind: 'system',
      text: server === null ? 'MCP 熔断已全部恢复。' : `MCP 熔断已恢复：${server}。`,
    })
    emit('room', updated)
    return ok({ room: updated })
  }

  const setBudget = (room, body) => {
    const usd = Number(body.budgetUsd)
    if (!Number.isFinite(usd) || usd < 0) return fail('invalid', '预算必须是非负美元数')
    const budgetMicroUsd = usd === 0 ? 0 : Math.max(1, Math.round(usd * 1_000_000))
    let resumed = false
    const updated = updateRoom(room.id, current => {
      current.usage = { ...current.usage, budgetMicroUsd }
      const status = budgetStatus(current, readRooms())
      if (current.state === 'paused' && current.pauseReason === 'budget' && status.ok) {
        current.state = 'active'
        current.pauseReason = null
        current.budgetBlocked = false
        current.idle = false
        resumed = true
      } else if (current.state === 'active' && !status.ok) {
        current.state = 'paused'
        current.pauseReason = 'budget'
        current.budgetBlocked = true
        current.idle = false
      }
      return { events: [{ type: 'room.budget', payload: { budgetMicroUsd } }] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    appendMessage(room.id, { kind: 'system', text: `房间预算已设为 ${usd === 0 ? '不限' : `$${usd.toFixed(2)}`}` })
    const status = budgetStatus(updated, readRooms())
    if (!resumed && !status.ok && updated.state !== 'stopped' && updated.state !== 'complete') {
      appendMessage(room.id, { kind: 'system', text: `预算已用尽：${status.message}；${budgetHint(status)}。` })
    }
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    if (resumed) {
      const active = updated.stages.findIndex(stage => stage.state === 'active')
      const stage = updated.stages[active]
      if (updated.live === true && (stage?.kind === 'deliverable' || stage?.manual === true)) {
        const hasEvidence = readMessages(room.id).some(message => (
          message.kind === 'evidence' && (message.meta?.stage ?? 0) === active
        ))
        if (!hasEvidence && updated.busy !== true) {
          void live.startStage(updated, active).catch(error => {
            appendMessage(room.id, { kind: 'system', text: `继续执行失败：${error?.message ?? error}` })
          })
        }
      }
    }
    return ok({ room: updated })
  }

  const control = async (room, action) => {
    if (action === 'pause' && room.state !== 'active') return fail('conflict', '只有进行中的房间能暂停')
    if (action === 'resume' && room.state !== 'paused') return fail('conflict', '这个房间没有暂停')
    if (action === 'stop' && room.state !== 'active' && room.state !== 'paused') {
      return fail('conflict', '这个房间已经结束')
    }
    if (action === 'resume') {
      const status = budgetStatus(room, readRooms())
      if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
    }
    const expected = room.state
    const nextState = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped'
    const updated = updateRoom(room.id, current => {
      if (current.state !== expected) return null
      current.state = nextState
      current.idle = false
      if (nextState === 'active') {
        current.noProgress = 0
        current.pauseReason = null
        current.budgetBlocked = false
      }
      if (nextState === 'paused') current.pauseReason = 'manual'
      return { events: [{ type: 'room.state', payload: { state: nextState, action } }] }
    })
    if (updated === null) return fail('conflict', '房间状态已变化，重试')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())

    const liveRoom = room.live === true
    let cancelled = false
    // 引擎能取消就真取消；不能取消时文案如实说明，不假装停下了。
    if (liveRoom && action !== 'resume') {
      try {
        cancelled = (await live.cancel({ roomId: room.id })).cancelled === true
      } catch {
        cancelled = false
      }
      live.expireApprovals(room.id, action === 'pause' ? '房间已暂停' : '房间已停止')
    }
    const note = action === 'pause'
      ? liveRoom
        ? cancelled
          ? '已暂停 · 基座里的回合已取消；已落盘的阶段与证据保留'
          : '已暂停 · 你的消息不再转发给基座；基座里正在跑的回合无法从这里中断'
        : '已暂停 · 阶段与证据保留，继续时从当前阶段接着走'
      : action === 'resume'
        ? '已继续 · 从当前阶段接着走'
        : liveRoom
          ? cancelled
            ? '已停止 · 基座里的回合已取消；已落盘的阶段与证据保留'
            : '已停止 · 你的消息不再转发给基座；已落盘的阶段与证据保留'
          : '已停止 · 已通过的阶段与证据保留，不会再派新活'
    appendMessage(room.id, { kind: 'system', text: note })
    if (action === 'resume' && liveRoom) {
      const active = room.stages.findIndex(stage => stage.state === 'active')
      const stage = room.stages[active]
      if (stage?.kind === 'deliverable' || stage?.manual === true) {
        const hasEvidence = readMessages(room.id).some(message => (
          message.kind === 'evidence' && (message.meta?.stage ?? 0) === active
        ))
        if (!hasEvidence && room.busy !== true) {
          void live.startStage(room, active).catch(error => {
            appendMessage(room.id, { kind: 'system', text: `继续执行失败：${error?.message ?? error}` })
          })
        }
      }
    }
    return ok({ room })
  }

  return { resetMcp, setBudget, control }
}
