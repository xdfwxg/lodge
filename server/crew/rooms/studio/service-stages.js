import { activeDispatchAssignments, transitionAssignment } from '../../assignments.js'
import { compactRoom } from '../../assignment-history.js'
import { leadMemberOf } from '../../room-members.js'
import { gateFor } from './gates.js'
import { fail, ok } from '../../result.js'
import { acceptanceChangeError } from '../../service-policy.js'
import { FINAL_TITLE } from './stage-plan.js'
import { reworkFloor } from './verifiers.js'
import { childResultText, childVerdictsOf, settleSubroomAssignment } from './subrooms.js'
import { roomModeOfRoom } from '../kinds.js'
import { studioTransitionEvent, transitionStudio } from './state.js'
import { memberDisplayName } from '../../member-labels.js'
import { verifierIds } from '../../room-members.js'
import { systemNotice } from '../../notices.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { verdictPassed } from '../../../../shared/judgment.js'
import { isWorkStage } from './turn-utils.js'
import { appendHumanContext } from '../../human-context.js'

export const createServiceStages = ({ store, live, emit, completeRoom, roomFiles }) => {
  const { readMessages, readEvidence, updateRoom, appendMessage } = store

  // 阶段推进或重做后，旧尝试的确认卡不再等人；拒绝基座卡并把记录标成过期。
  const expireCards = (roomId, reason) => {
    const task = live?.expireApprovals?.(roomId, reason)
    if (task !== undefined && task !== null && typeof task.catch === 'function') task.catch(() => {})
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
        name: memberDisplayName(room, message.authorId),
        pass: verdictPassed(message),
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
    const childMessages = readMessages(child.id)
    const verdicts = childVerdictsOf(childMessages)
    const text = childResultText(child, verdicts)
    settleSubroomAssignment({
      store,
      parent,
      child,
      resultText: text,
      verdictMessages: childMessages.filter(message => message.kind === 'verdict' && (message.meta?.roleKind ?? 'verifier') === 'verifier'),
    })
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
      const lead = leadMemberOf(parent)?.id
      if (typeof lead === 'string' && lead !== '') {
        void live.sendToMember(parent.id, lead, `${text}\n请只依据这些 verdict 决定下一步。`, {
          intent: 'notice',
          from: '子房间',
        }).catch(error => {
          systemNotice({ store, roomId: parent.id, text: '子房间的结果没能叫醒规划师；稍后会自动再试。', error })
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
    const hasPassedVerdict = messages.some(message => message.kind === 'verdict' && verdictPassed(message))
    const updated = updateRoom(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id), readEvidence?.(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = 'passed'
      next = current.stages.findIndex(item => item.state === 'pending')
      // 最后一道「验收与结论」是系统收尾阶段：签掉最后一个工作阶段时一起确认，
      // 不再让用户为同一个判断点两次。
      if (next >= 0 && next === current.stages.length - 1 && current.stages[next].title === FINAL_TITLE) {
        mergedFinal = next
        current.stages[next].state = 'passed'
        next = -1
      }
      if (next >= 0) current.stages[next].state = 'active'
      // 纯聊天：最后一步通过后房间不结束；但有验收员时，交付型步骤仍必须看到他回报通过。
      // 纯决策步骤由人确认就算通过，不该再等验收员。
      const needsVerdict = stage.kind !== 'decision' || stage.manual === true || stage.title === FINAL_TITLE
      if (next < 0 && needsVerdict && roomModeOfRoom(current)?.supportsDelivery === true) {
        const hasVerifiers = verifierIds(current).length > 0 || (Array.isArray(current.verifiers) && current.verifiers.length > 0)
        if (hasVerifiers && hasPassedVerdict !== true) {
          transitionError = '验收员还没有回报通过，不能结束这一步'
          return null
        }
      }
      const closureEvents = []
      if (next >= 0 && roomModeOfRoom(current)?.supportsDelivery === true) {
        const event = next === current.stages.length - 1 ? 'await_sign' : 'stage_advanced'
        const moved = transitionStudio(current.closure ?? 'open', event, {})
        if (!moved.ok) {
          transitionError = moved.error
          return null
        }
        current.closure = moved.state
        closureEvents.push(studioTransitionEvent(moved, event, 'you', {}, next === current.stages.length - 1 ? '等待人工签字' : '阶段通过'))
      }
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by: 'you' } },
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
    expireCards(room.id, '这一步已经过了')
    if (next >= 0) appendMessage(room.id, stageConclusion(room, room.stages[index], index, next))
    const finalStage = mergedFinal >= 0 ? room.stages[mergedFinal] : null
    appendMessage(room.id, {
      kind: 'system',
      text: finalStage === null
        ? `第 ${index + 1} 步「${gate.stage.title}」${gate.stage.kind === 'deliverable' ? '通过了' : '确认了'}。`
        : `第 ${index + 1} 步「${gate.stage.title}」通过了；第 ${mergedFinal + 1} 步「${finalStage.title}」也一起确认了。`,
      meta: { kind: 'gate', gate: gate.stage.kind, stage: index, by: 'you' },
    })
    for (const assignment of activeDispatchAssignments(store, room.id, index)) {
      transitionAssignment(store, assignment.id, 'passed')
    }
    compactRoom(store, room.id)
    // 工作室的顶层房间也要收尾：最后一步通过就生成交付记录、写记忆；
    // 子房间另外把结果回填给父房间。
    const completes = next < 0
    const finalRoom = completes ? completeRoom(room) ?? room : room
    if (completes && typeof room.parentRoomId === 'string' && room.parentRoomId !== '') notifyParent(finalRoom)
    // 有下一步才叫醒规划师；最后一步通过就是句号，不再叫它补一句收尾。
    const nextStage = next >= 0 ? room.stages[next] : null
    const lead = leadMemberOf(room)?.id
    if (nextStage !== null && room.live === true && typeof lead === 'string' && lead !== '' && typeof live.sendToMember === 'function') {
      const prompt = [
        `第 ${index + 1} 步「${gate.stage.title}」验收通过了。下一步是第 ${next + 1} 步「${nextStage.title}」。`,
        nextStage.acceptance ? `完成标准：${nextStage.acceptance}` : '',
        '要继续，就在群里 @ 执行成员，把下一步说清楚；要收尾或改计划，就直说。',
      ].filter(Boolean).join('\n')
      void live.sendToMember(room.id, lead, `${prompt}\n${INTERNAL_PROMPT_MARKER}`, { intent: 'notice', from: '房间' })
        .catch(error => systemNotice({ store, roomId: room.id, text: '没能叫住规划师；下一步还没安排。', error }))
    }
    return ok({ room: finalRoom })
  }

  // 重试是重做的一种：不要求人再写一段原因，直接按当前目标再跑一次。
  // 带 memberId 时只重开这条并行分支，兄弟分支的证据和结果保留。
  const retry = (room, body) => {
    const note = typeof body?.note === 'string' && body.note.trim() !== ''
      ? body.note.trim().slice(0, 2000)
      : '按当前目标再试一次。'
    const memberId = typeof body?.memberId === 'string' ? body.memberId.trim() : ''
    if (memberId === '') return rework(room, { ...body, note })
    const index = Number(body?.stage)
    const stage = room.stages?.[index]
    if (stage === undefined) return fail('invalid', '没有这一步')
    if (stage.kind !== 'deliverable' && stage.manual !== true) return fail('invalid', '这一步不能重试')
    if (stage.state !== 'active') return fail('conflict', '这一步现在不需要重试')
    if (room.state !== 'active') return fail('conflict', '先让房间继续，再重试这一分支')
    if ((room.busyMembers ?? []).length > 0) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (activeDispatchAssignments(store, room.id, index).every(item => item.toMemberId !== memberId)) {
      return fail('invalid', '这个成员没有这一步的分支')
    }
    const message = appendMessage(room.id, {
      kind: 'rework',
      authorId: 'you',
      text: note,
      meta: { stage: index, source: 'retry', memberId, requestedAt: Date.now() },
    })
    appendHumanContext({ store, roomId: room.id, stage: index, text: note, source: 'retry' })
    if (room.live === true && typeof live.retryMember === 'function') {
      void live.retryMember(room, index, memberId, note).catch(error => {
        systemNotice({ store, roomId: room.id, text: '这一分支没能重试；需要你处理。', error })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录重试意见；这个房间现在没有连上，需要你继续或重新开始。' })
    }
    return ok({ room, message })
  }

  const rework = (room, body) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    const stage = room.stages?.[index]
    if (stage === undefined) return fail('invalid', '没有这一步')
    if (stage.kind !== 'deliverable' && stage.manual !== true) return fail('invalid', '这一步不能重做')
    if (room.state !== 'active') return fail('conflict', '先让房间继续，再重做这一步')
    if ((room.busyMembers ?? []).length > 0) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '验收员还在看，等结论出来再继续')
    }
    if (stage.state !== 'active') return fail('conflict', '这一步现在不需要重做')
    const message = appendMessage(room.id, {
      kind: 'rework',
      authorId: 'you',
      text: note === '' ? '结果不对，请重新对照目标后重做。' : note,
      meta: { stage: index, source: 'human', requestedAt: Date.now() },
    })
    appendHumanContext({ store, roomId: room.id, stage: index, text: note, source: 'rework' })
    const updated = updateRoom(room.id, current => {
      const target = current.stages?.[index]
      if (target === undefined || target.state !== 'active') return null
      // 人的补充已经进入这次重跑；旧的“交给人”收口不能再拦住下一次输入。
      current.lastPlannerDecision = null
      return { events: [{ type: 'stage.rework', payload: { stage: index, note } }] }
    })
    if (updated === null) return fail('conflict', '这一步的状态变了，再试一次')
    for (const assignment of activeDispatchAssignments(store, room.id, index)) {
      transitionAssignment(store, assignment.id, 'failed', { resultText: '人要求重做这一步' })
    }
    emit('room', updated)
    expireCards(room.id, '这一步已经重做了')
    if (room.live === true && typeof live.reworkStage === 'function') {
      void live.reworkStage(updated, index, note).catch(error => {
        systemNotice({ store, roomId: room.id, text: '重做没能开始；需要你处理。', error })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录重做意见；这个房间现在没有连上，需要你继续或重新开始。' })
    }
    return ok({ room: updated, message })
  }

  // 退回指定步骤：目标步骤重新变成当前步骤，后面的步骤全部重来。
  // 人工关口的“补一句再跑”也走这里——目标是当前步骤时，效果就是带上下文重跑一次。
  const rewind = (room, body) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 4000) : ''
    const stage = room.stages?.[index]
    if (stage === undefined) return fail('invalid', '没有这一步')
    if (!isWorkStage(stage) && stage.kind !== 'decision') return fail('invalid', '只有步骤能退回')
    if (stage.state === 'pending') return fail('conflict', '这一步还没开始，不能退回')
    if (room.state !== 'active') return fail('conflict', '先让房间继续，再退回这一步')
    if ((room.busyMembers ?? []).length > 0) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '验收员还在看，等结论出来再继续')
    }
    if (note === '') return fail('invalid', '写一句要补的上下文，或要改什么')
    const updated = updateRoom(room.id, current => {
      const target = current.stages?.[index]
      if (target === undefined || target.state === 'pending') return null
      for (let at = index; at < current.stages.length; at += 1) {
        current.stages[at].state = at === index ? 'active' : 'pending'
      }
      // 后面的阶段重新开始时从当时的 HEAD 取起点；目标步骤自己的起点要保留。
      for (const key of Object.keys(current.stageBases ?? {})) {
        if (Number(key) > index) delete current.stageBases[key]
      }
      current.closure = stage.kind === 'decision' ? 'open' : 'executing'
      current.mergeConflict = null
      current.blocked = null
      current.autoCheck = null
      current.lastPlannerDecision = null
      current.openQuestion = null
      return { events: [{ type: 'stage.rewind', payload: { stage: index, note } }] }
    })
    if (updated === null) return fail('conflict', '这一步的状态变了，再试一次')
    for (let at = index; at < updated.stages.length; at += 1) {
      for (const assignment of activeDispatchAssignments(store, room.id, at)) {
        transitionAssignment(store, assignment.id, at === index ? 'failed' : 'cancelled', {
          resultText: at === index ? '人要求退回这一步' : '前面重做了，这一步重新来',
        })
      }
    }
    appendMessage(room.id, {
      kind: 'rework',
      authorId: 'you',
      text: note,
      meta: { stage: index, source: 'rewind', requestedAt: Date.now() },
    })
    appendHumanContext({ store, roomId: room.id, stage: index, text: note, source: 'rewind' })
    for (let at = index + 1; at < updated.stages.length; at += 1) {
      appendMessage(room.id, {
        kind: 'rework',
        authorId: 'system',
        text: '前面重做了，这一步要重新来。',
        meta: { stage: at, source: 'rewind' },
      })
    }
    emit('room', updated)
    expireCards(room.id, '这一步已经重做了')
    if (stage.kind === 'decision') {
      const lead = leadMemberOf(updated)?.id
      if (stage.manual === true) {
        appendMessage(room.id, { kind: 'system', text: `第 ${index + 1} 步「${stage.title}」重新打开，请你重新确认。` })
      } else if (typeof lead === 'string' && lead !== '' && room.live === true && typeof live.sendToMember === 'function') {
        const prompt = [
          `第 ${index + 1} 步「${stage.title}」要重新确认。`,
          `用户补充：${note}`,
          '请只重新说明这一步的结论或方案；不要改文件，不要验收。',
          INTERNAL_PROMPT_MARKER,
        ].join('\n')
        void live.sendToMember(updated.id, lead, prompt, { intent: 'notice', from: 'you' }).catch(error => {
          systemNotice({ store, roomId: room.id, text: '这一步没能重新开始；需要你处理。', error })
        })
      } else {
        appendMessage(room.id, { kind: 'system', text: '这一步已经重新打开；需要你继续或重新开始。' })
      }
    } else if (room.live === true && typeof live.reworkStage === 'function') {
      void live.reworkStage(updated, index, note).catch(error => {
        systemNotice({ store, roomId: room.id, text: '退回没能开始；需要你处理。', error })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录退回意见；这个房间现在没有连上，需要你继续或重新开始。' })
    }
    return ok({ room: updated })
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
        systemNotice({ store, roomId: room.id, text: '检查已经更新，但这次没跑成；需要你处理。', error })
      })
    }
    return ok({ room, message })
  }

  return { accept, rework, retry, rewind, setAcceptance }
}
