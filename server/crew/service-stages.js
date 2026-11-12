import { budgetHint, budgetStatus } from './budget.js'
import { gateFor } from './gates.js'
import { fail, ok } from './result.js'
import { acceptanceChangeError } from './service-policy.js'
import { editStages } from './stage-plan.js'
import { reworkFloor } from './verifiers.js'

export const createServiceStages = ({ store, live, emit, dispatchPayload, completeRoom, roomFiles }) => {
  const { readRooms, readMessages, updateRoom, appendMessage } = store

  const editStagePlan = (room, body) => {
    const result = editStages(room, body?.action, body?.index, body?.stage)
    if (result.error !== undefined) return fail('invalid', result.error)
    const updated = updateRoom(room.id, current => {
      current.stages = result.stages
      return { events: [result.event] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    roomFiles.writeGoal(updated)
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

  const stageConclusion = (room, stage, index, next) => {
    const messages = readMessages(room.id)
    const floor = reworkFloor(messages, index)
    const evidence = [...messages].reverse().find(message => (
      message.kind === 'evidence' &&
      (message.seq ?? 0) > floor &&
      message.meta?.kind === 'command' &&
      (message.meta?.stage ?? 0) === index
    ))
    const verdicts = messages
      .filter(message => (
        message.kind === 'verdict' &&
        (message.meta?.stage ?? 0) === index &&
        (message.seq ?? 0) > floor
      ))
      .slice(-5)
      .map(message => ({
        name: room.seatNames?.[message.authorId] ?? message.authorId,
        pass: message.meta?.pass === true,
      }))
    return {
      kind: 'stage_conclusion',
      authorId: 'system',
      text: `阶段 ${index + 1}「${stage.title}」已通过`,
      meta: {
        stage: index,
        title: stage.title,
        command: typeof evidence?.meta?.command === 'string' ? evidence.meta.command : '',
        exit: evidence?.meta?.exit ?? null,
        files: Array.isArray(evidence?.meta?.files) ? evidence.meta.files : [],
        verdicts,
        next: next >= 0 ? room.stages[next]?.title ?? null : null,
      },
    }
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
    if (!room.demo) roomFiles.writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())
    if (next >= 0) appendMessage(room.id, stageConclusion(room, room.stages[index], index, next))
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

  const rework = (room, body) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const stage = room.stages?.[index]
    if (stage === undefined) return fail('invalid', '没有这个阶段')
    if (stage.kind !== 'deliverable' && stage.manual !== true) return fail('invalid', '这个阶段不能重做')
    if (room.state !== 'active') return fail('conflict', '先继续房间，再重做当前阶段')
    if (room.busy === true) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '复核进行中，先等验收结论')
    }
    if (stage.state !== 'active') return fail('conflict', '这个阶段不在待返工状态')
    const status = budgetStatus(room, readRooms())
    if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
    const message = appendMessage(room.id, {
      kind: 'rework',
      authorId: 'you',
      text: note === '' ? '结果不对，请重新对照目标后重做。' : note,
      meta: { stage: index, requestedAt: Date.now() },
    })
    const updated = updateRoom(room.id, current => {
      const target = current.stages?.[index]
      if (target === undefined || target.state !== 'active') return null
      if (Array.isArray(target.tasks)) target.tasks = target.tasks.map(task => ({ ...task, status: 'working' }))
      return { events: [{ type: 'stage.rework', payload: { stage: index, note } }] }
    })
    if (updated === null) return fail('conflict', '阶段状态已变化，重试')
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    if (room.live === true && typeof live.reworkStage === 'function') {
      void live.reworkStage(updated, index, note).catch(error => {
        appendMessage(room.id, { kind: 'system', text: `重审返工启动失败：${error?.message ?? error}` })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录返工意见；这个房间没有连接实时基座，需要你继续或重新开工。' })
    }
    return ok({ room: updated, message })
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
    if (!room.demo) roomFiles.writeGoal(room)
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

  return { editStagePlan, accept, rework, setAcceptance }
}
