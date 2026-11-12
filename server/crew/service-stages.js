import { budgetHint, budgetStatus } from './budget.js'
import { gateFor } from './gates.js'
import { fail, ok } from './result.js'
import { writeGoal } from './room-repo.js'
import { acceptanceChangeError } from './service-policy.js'
import { editStages } from './stage-plan.js'

export const createServiceStages = ({ store, live, emit, dispatchPayload, completeRoom }) => {
  const { readRooms, readMessages, updateRoom, appendMessage } = store

  const editStagePlan = (room, body) => {
    const result = editStages(room, body?.action, body?.index, body?.stage)
    if (result.error !== undefined) return fail('invalid', result.error)
    const updated = updateRoom(room.id, current => {
      current.stages = result.stages
      return { events: [result.event] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    writeGoal(updated)
    emit('room', updated)
    appendMessage(room.id, {
      kind: 'system',
      text: result.event.type === 'stage.added'
        ? `已添加阶段：${updated.stages[result.event.payload.index]?.title ?? ''}`
        : result.event.type === 'stage.removed'
          ? '已移除一个未开始阶段'
          : `已更新阶段：${updated.stages[result.event.payload.index]?.title ?? ''}`,
    })
    return ok({ room: updated })
  }

  const accept = (room, body) => {
    const index = Number(body.stage)
    let gate = null
    let next = -1
    const updated = updateRoom(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = 'passed'
      if (Array.isArray(stage.tasks)) stage.tasks = stage.tasks.map(task => ({ ...task, status: 'done' }))
      next = current.stages.findIndex(item => item.state === 'pending')
      if (next >= 0) current.stages[next].state = 'active'
      else current.state = 'complete'
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by: 'you' } },
          ...(next < 0 ? [{ type: 'room.complete', payload: {} }] : []),
        ],
      }
    })
    if (gate !== null && gate.ok === false) return fail(gate.reason, gate.error)
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())
    appendMessage(room.id, {
      kind: 'system',
      text: gate.stage.kind === 'deliverable'
        ? `阶段 ${index + 1} 已按证据验收`
        : `阶段 ${index + 1} 已由你确认`,
      meta: { kind: 'gate', gate: gate.stage.kind, stage: index, by: 'you' },
    })
    let finalRoom = next < 0 ? completeRoom(room) ?? room : room
    if (next >= 0 && room.live === true && room.stages[next]?.kind === 'deliverable' && typeof live.startStage === 'function') {
      const status = budgetStatus(room, readRooms())
      if (!status.ok) {
        const paused = updateRoom(room.id, current => {
          if (current.state !== 'active') return null
          current.state = 'paused'
          current.pauseReason = 'budget'
          current.budgetBlocked = true
          current.idle = false
          return { events: [{ type: 'room.budget_pause', payload: { reason: status.roomBlocked ? 'room' : 'global' } }] }
        })
        if (paused !== null) {
          appendMessage(room.id, {
            kind: 'system',
            text: `预算已用尽：${status.message}；下一阶段已暂停，${budgetHint(status)}。`,
          })
          emit('room', paused)
          emit('dispatch', dispatchPayload())
          finalRoom = paused
        }
      } else {
        void live.startStage(room, next).catch(error => {
          appendMessage(room.id, { kind: 'system', text: `启动执行失败：${error?.message ?? error}` })
        })
      }
    }
    return ok({ room: finalRoom })
  }

  const setAcceptance = (room, index, command) => {
    let rejection = null
    const updated = updateRoom(room.id, current => {
      const stage = current.stages[index]
      const invalid = acceptanceChangeError(stage, command)
      if (invalid !== null) {
        rejection = invalid
        return null
      }
      const trimmed = command.trim()
      if (trimmed === '') delete stage.acceptance
      else stage.acceptance = trimmed
      return { events: [{ type: 'stage.acceptance', payload: { stage: index, command: stage.acceptance ?? '' } }] }
    })
    if (rejection !== null) return fail(rejection[0], rejection[1])
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    const trimmed = command.trim()
    const message = appendMessage(room.id, {
      kind: 'system',
      text: trimmed === ''
        ? `阶段 ${index + 1} 的验收命令已清空`
        : `阶段 ${index + 1} 的验收命令：\`${trimmed}\``,
    })
    return ok({ room, message })
  }

  return { editStagePlan, accept, setAcceptance }
}
