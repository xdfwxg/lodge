import { gateFor } from './gates.js'
import { fail, ok } from '../../result.js'
import { acceptanceChangeError } from '../../service-policy.js'
import { FINAL_TITLE } from './stage-plan.js'
import { reworkFloor } from './verifiers.js'
import { childResultText, childVerdictsOf } from './subrooms.js'
import { roomModeOfRoom } from '../kinds.js'
import { studioTransitionEvent, transitionStudio } from './state.js'
import { seatDisplayName } from '../../seat-labels.js'

export const createServiceStages = ({ store, live, emit, completeRoom, roomFiles }) => {
  const { readMessages, readEvidence, updateRoom, appendMessage } = store

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
        name: seatDisplayName(room, message.authorId),
        pass: message.meta?.pass === true,
      }))
    return {
      kind: 'stage_conclusion',
      authorId: 'system',
      text: `第 ${index + 1} 步「${stage.title}」已确认通过`,
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

  const notifyParent = child => {
    if (typeof child?.parentRoomId !== 'string' || child.parentRoomId === '') return
    const parent = store.readRoom(child.parentRoomId)
    if (parent === null) return
    const verdicts = childVerdictsOf(readMessages(child.id))
    const text = childResultText(child, verdicts)
    appendMessage(parent.id, {
      kind: 'child_result',
      authorId: 'system',
      text,
      meta: {
        childRoomId: child.id,
        childName: child.name,
        depth: child.depth ?? 1,
        verdicts,
      },
    })
    const linked = updateRoom(parent.id, current => {
      current.childResults = [...(current.childResults ?? []), { roomId: child.id, name: child.name, at: Date.now() }].slice(-10)
      return { events: [{ type: 'room.child_result', payload: { childRoomId: child.id } }] }
    })
    if (linked !== null) emit('room', linked)
    if (typeof live.isAttached === 'function' && live.isAttached(parent.id) === true) {
      const lead = parent.leadSeat ?? parent.members?.[0]
      if (typeof lead === 'string' && lead !== '') {
        void live.sendToSeat(parent.id, lead, `${text}\n请只依据这些 verdict 决定下一步。`, {
          intent: 'notice',
          from: '子房间',
        }).catch(error => {
          appendMessage(parent.id, { kind: 'system', text: `子房间的结果没能叫醒规划师：${error?.message ?? error}` })
        })
      }
    }
  }

  const accept = (room, body) => {
    const index = Number(body.stage)
    let gate = null
    let next = -1
    let mergedFinal = -1
    let transitionError = null
    const messages = readMessages(room.id)
    const verdictPassed = messages.some(message => message.kind === 'verdict' && message.meta?.pass === true)
    const updated = updateRoom(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id), readEvidence?.(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = 'passed'
      if (Array.isArray(stage.tasks)) stage.tasks = stage.tasks.map(task => ({ ...task, status: 'done' }))
      next = current.stages.findIndex(item => item.state === 'pending')
      // 最后一道「验收与结论」是系统收尾阶段：签掉最后一个工作阶段时一起确认，
      // 不再让用户为同一个判断点两次。
      if (next >= 0 && next === current.stages.length - 1 && current.stages[next].title === FINAL_TITLE) {
        mergedFinal = next
        current.stages[next].state = 'passed'
        next = -1
      }
      if (next >= 0) current.stages[next].state = 'active'
      else current.state = 'complete'
      const closureEvents = []
      if (roomModeOfRoom(current)?.supportsDelivery === true) {
        // 最后一段可能是在 planned/executing 里直接签的（前面的确认阶段不走执行转移）；
        // 签字前先把房间送进 verifying，再走 sign，状态机才完整。
        if (next < 0 && (current.closure ?? 'open') !== 'verifying') {
          const waiting = transitionStudio(current.closure ?? 'open', 'await_sign')
          if (!waiting.ok) {
            transitionError = waiting.error
            return null
          }
          current.closure = waiting.state
          closureEvents.push(studioTransitionEvent(waiting, 'await_sign', 'you', {}, '人工签字前进入待签'))
        }
        const event = next < 0 ? 'sign' : next === current.stages.length - 1 ? 'await_sign' : 'stage_advanced'
        const moved = transitionStudio(current.closure ?? 'open', event, next < 0 ? { verdictPassed, human: true } : {})
        if (!moved.ok) {
          transitionError = moved.error
          return null
        }
        current.closure = moved.state
        closureEvents.push(studioTransitionEvent(moved, event, 'you', {}, next < 0 ? '人工签字' : next === current.stages.length - 1 ? '等待人工签字' : '阶段通过'))
      }
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by: 'you' } },
          ...(next < 0 ? [{ type: 'room.complete', payload: {} }] : []),
          ...closureEvents,
        ],
      }
    })
    if (gate !== null && gate.ok === false) return fail(gate.reason, gate.error)
    if (transitionError !== null) return fail('conflict', transitionError)
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) roomFiles.writeGoal(room)
    emit('room', room)
    if (roomModeOfRoom(room)?.supportsDelivery === true && (gate.stage.kind === 'deliverable' || gate.stage.manual === true)) {
      const evidence = [...readMessages(room.id)].reverse().find(message => (
        message.kind === 'evidence' && (message.meta?.stage ?? 0) === index
      ))
      if (evidence !== undefined) {
        appendMessage(room.id, {
          kind: 'verdict',
          authorId: 'you',
          text: '人工签字通过。',
          meta: {
            pass: true,
            reason: 'human signoff',
            roleKind: 'verifier',
            verifierProfile: 'human',
            mode: 'human',
            stage: index,
            evidenceId: evidence.id,
            human: true,
          },
        })
      }
    }
    if (next >= 0) appendMessage(room.id, stageConclusion(room, room.stages[index], index, next))
    appendMessage(room.id, {
      kind: 'system',
      text: gate.stage.kind === 'deliverable'
        ? `阶段 ${index + 1} 已按证据验收`
        : `第 ${index + 1} 步已经定了`,
      meta: { kind: 'gate', gate: gate.stage.kind, stage: index, by: 'you' },
    })
    if (mergedFinal >= 0) {
      appendMessage(room.id, {
        kind: 'system',
        text: `第 ${mergedFinal + 1} 步已经定了`,
        meta: { kind: 'gate', gate: 'decision', stage: mergedFinal, by: 'you' },
      })
    }
    let finalRoom = next < 0 ? completeRoom(room) ?? room : room
    if (next < 0) notifyParent(finalRoom)
    if (next >= 0 && room.live === true && room.stages[next]?.kind === 'deliverable' && typeof live.startStage === 'function') {
      void live.startStage(room, next).catch(error => {
        appendMessage(room.id, { kind: 'system', text: `启动执行失败：${error?.message ?? error}` })
      })
    }
    return ok({ room: finalRoom })
  }

  const rework = (room, body) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const stage = room.stages?.[index]
    if (stage === undefined) return fail('invalid', '没有这一步')
    if (stage.kind !== 'deliverable' && stage.manual !== true) return fail('invalid', '这一步不能重做')
    if (room.state !== 'active') return fail('conflict', '先让房间继续，再重做这一步')
    if (room.busy === true) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '验收员还在看，等结论出来再继续')
    }
    if (stage.state !== 'active') return fail('conflict', '这一步现在不需要重做')
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
    if (updated === null) return fail('conflict', '这一步的状态变了，再试一次')
    emit('room', updated)
    if (room.live === true && typeof live.reworkStage === 'function') {
      void live.reworkStage(updated, index, note).catch(error => {
        appendMessage(room.id, { kind: 'system', text: `重做没能开始：${error?.message ?? error}` })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录重做意见；这个房间现在没有连上，需要你继续或重新开始。' })
    }
    return ok({ room: updated, message })
  }

  const setAcceptance = (room, index, command) => {
    let rejection = null
    let previous = ''
    let changed = false
    const updated = updateRoom(room.id, current => {
      const stage = current.stages[index]
      const invalid = acceptanceChangeError(stage, command)
      if (invalid !== null) {
        rejection = invalid
        return null
      }
      previous = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
      const trimmed = command.trim()
      changed = trimmed !== previous
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
    if (changed && trimmed !== '' && room.live === true && room.stages[index]?.state === 'active' && typeof live.isAttached === 'function' && live.isAttached(room.id) === true && typeof live.resume === 'function') {
      void live.resume(room.id, { forceAcceptance: true }).catch(error => {
        appendMessage(room.id, { kind: 'system', text: `检查已经更新，但没能重新跑：${error?.message ?? error}` })
      })
    }
    return ok({ room, message })
  }

  return { accept, rework, setAcceptance }
}
