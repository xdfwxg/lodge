import { activeDispatchAssignments, transitionAssignment } from '../../../assignments.js'
import { compactRoom } from '../../../assignment-history.js'
import { gateFor } from '../acceptance/gates.js'
import { fail, ok } from '../../../result.js'
import { FINAL_TITLE } from './stage-plan.js'
import { reworkFloor } from '../acceptance/verifiers.js'
import { memberDisplayName } from '../../../member-labels.js'
import { systemNotice } from '../../../notices.js'
import { verdictPassed } from '../../../../../shared/judgment.js'
import { isWorkStage } from '../runtime/turn-utils.js'
import { appendHumanContext } from '../../../human-context.js'
import { ASSIGNMENT_STATUS, ROOM_STATE, STAGE_STATE } from '../../../../../shared/states.js'
import { COMMAND_BY, commandRefusal } from '../../../../../shared/studio-commands.js'

export const createServiceStages = ({ store, live, emit, completeRoom, roomFiles, workspace = null }) => {
  const { readMessages, readEvidence, updateRound, appendMessage } = store

  // 阶段推进或重做后，旧尝试的确认卡不再等人；拒绝基座卡并把记录标成过期。
  const expireCards = (roomId, reason) => {
    const task = live?.expireApprovals?.(roomId, reason)
    if (task !== undefined && task !== null && typeof task.catch === 'function') task.catch(() => {})
  }

  // 阶段变成 active 的那一刻记下 HEAD：验收和交付不再依赖派发路径有没有调 startStage。
  const rememberStageBase = (room, index) => {
    if (workspace === null || typeof workspace.provider !== 'function') return room
    if (typeof room.repoPath !== 'string' || room.repoPath === '') return room
    try {
      const provider = workspace.provider(room)
      const base = provider.head?.({ path: room.repoPath })
      // 非 git 工作区没有 HEAD；同一刻记下文件清单，交付时才能算包外改动。
      const manifest = typeof provider.manifest === 'function'
        ? provider.manifest({ path: room.repoPath })
        : null
      const baseStored = typeof base === 'string' && base !== '' && room.stageBases?.[index] === base
      const manifestStored = !Array.isArray(manifest) || Array.isArray(room.stageBaseManifests?.[index])
      if ((typeof base !== 'string' || base === '') && !Array.isArray(manifest)) return room
      if (baseStored && manifestStored) return room
      const saved = updateRound(room.id, current => {
        let changed = false
        if (typeof base === 'string' && base !== '' && current.stageBases?.[index] !== base) {
          current.stageBases = { ...(current.stageBases ?? {}), [index]: base }
          changed = true
        }
        if (Array.isArray(manifest) && !Array.isArray(current.stageBaseManifests?.[index])) {
          current.stageBaseManifests = { ...(current.stageBaseManifests ?? {}), [index]: manifest }
          changed = true
        }
        return changed ? { events: [] } : null
      })
      return saved ?? room
    } catch {
      return room
    }
  }

  const stageConclusion = (room, stage, index, next) => {
    const messages = readMessages(room.id)
    const floor = reworkFloor(messages, index)
    const evidence = [...messages].reverse().find(message => (
      message.kind === 'evidence' &&
      (message.seq ?? 0) > floor &&
      message.meta?.kind === 'result' &&
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
        files: Array.isArray(evidence?.meta?.files) ? evidence.meta.files : [],
        verdicts,
        next: next >= 0 ? room.stages[next]?.title ?? null : null,
      },
    }
  }

  const accept = (room, body) => {
    const index = Number(body.stage)
    const by = body?.by === 'system' ? 'system' : 'you'
    const auto = body?.auto === true
    const target = room.stages?.[index]
    // 卡片的注意力会有一瞬间的旧快照：这一步已经过了就当确认成功，别再报错。
    if (target !== undefined && target.state === STAGE_STATE.passed) return ok({ room })
    const refusal = commandRefusal({
      command: 'accept',
      room,
      by: body?.by === 'system' ? COMMAND_BY.SYSTEM : COMMAND_BY.YOU,
      stageIndex: index,
    })
    if (refusal !== null) return fail(refusal.code, refusal.text)
    let gate = null
    let next = -1
    let mergedFinal = -1
    let transitionError = null
    const messages = readMessages(room.id)
    const updated = updateRound(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id), readEvidence?.(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = STAGE_STATE.passed
      next = current.stages.findIndex(item => item.state === STAGE_STATE.pending)
      // 最后一道「验收与结论」是系统收尾阶段：签掉最后一个工作阶段时一起确认，
      // 不再让用户为同一个判断点两次。
      if (next >= 0 && next === current.stages.length - 1 && current.stages[next].title === FINAL_TITLE) {
        mergedFinal = next
        current.stages[next].state = STAGE_STATE.passed
        next = -1
      }
      if (next >= 0) {
        current.stages[next].state = STAGE_STATE.active
        current.stages[next].activatedAt = Date.now()
      }
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by } },
          ...(mergedFinal < 0
            ? []
            : [{ type: 'stage.passed', payload: { stage: mergedFinal, kind: current.stages[mergedFinal].kind, by } }]),
        ],
      }
    })
    if (gate !== null && gate.ok === false) return fail(gate.reason, gate.error)
    if (transitionError !== null) return fail('conflict', transitionError)
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    // 新阶段从这一刻的 HEAD 起算；不依赖派发路径有没有走到 startStage。
    if (next >= 0) room = rememberStageBase(room, next)
    if (!room.demo) roomFiles.writeGoal(room)
    emit('room', room)
    expireCards(room.id, '这一步已经过了')
    if (next >= 0) appendMessage(room.id, stageConclusion(room, room.stages[index], index, next))
    for (const assignment of activeDispatchAssignments(store, room.id, index)) {
      transitionAssignment(store, assignment.id, ASSIGNMENT_STATUS.passed)
    }
    compactRoom(store, room.id)
    // 工作室的顶层房间也要收尾：最后一步通过就生成交付记录、写记忆；
    // 子房间另外把结果回填给父房间。
    const completes = next < 0
    const finalRoom = completes ? completeRoom(room) ?? room : room
    if (auto && completes) {
      appendMessage(room.id, {
        kind: 'system',
        text: '验收通过，已自动交付；你可以打开结果抽查。',
        meta: { kind: 'gate', stage: index, by, auto: true },
      })
    }
    // 下一步由系统直接派发；规划师不需要在群里 @ 人。最后一步通过就是句号。
    if (next >= 0 && room.live === true && typeof live?.startStage === 'function') {
      void Promise.resolve(live.startStage(room, next)).catch(error => {
        systemNotice({ store, roomId: room.id, text: '这一步过了，但下一步没能开始；待处理。', error })
      })
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
    const refusal = commandRefusal({ command: 'retry', room, by: COMMAND_BY.YOU, stageIndex: index })
    if (refusal !== null) return fail(refusal.code, refusal.text)
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
        systemNotice({ store, roomId: room.id, text: '这一分支没能重试；待处理。', error })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录重试意见；这个房间现在没有连上，请继续或重新开始。' })
    }
    return ok({ room, message })
  }

  const rework = (room, body) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 2000) : ''
    // 状态和身份只问命令目录：这里不再各写一份判断。
    const refusal = commandRefusal({ command: 'rework', room, by: COMMAND_BY.YOU, stageIndex: index })
    if (refusal !== null) return fail(refusal.code, refusal.text)
    if ((room.busyMembers ?? []).length > 0) return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '验收员还在看，等结论出来再继续')
    }
    const auto = note === ''
    const message = appendMessage(room.id, {
      kind: 'rework',
      authorId: 'you',
      text: auto ? '你让这一步重新做了一遍。' : note,
      meta: { stage: index, source: 'human', requestedAt: Date.now(), ...(auto ? { auto: true } : {}) },
    })
    appendHumanContext({ store, roomId: room.id, stage: index, text: note, source: 'rework' })
    const updated = updateRound(room.id, current => {
      const target = current.stages?.[index]
      if (target === undefined || target.state !== STAGE_STATE.active) return null
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
        systemNotice({ store, roomId: room.id, text: '重做没能开始；待处理。', error })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录重做意见；这个房间现在没有连上，请继续或重新开始。' })
    }
    return ok({ room: updated, message })
  }

  // 退回指定步骤：目标步骤重新变成当前步骤，后面的步骤全部重来。
  // 人工关口的“补一句再跑”也走这里——目标是当前步骤时，效果就是带上下文重跑一次。
  const rewind = (room, body, { allowBusy = false } = {}) => {
    const index = Number(body?.stage)
    const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 4000) : ''
    const refusal = commandRefusal({ command: 'rewind', room, by: COMMAND_BY.YOU, stageIndex: index })
    if (refusal !== null) return fail(refusal.code, refusal.text)
    if (allowBusy !== true && (room.busyMembers ?? []).length > 0) {
      return fail('conflict', '房间还有回合在跑；先等这一回合结束')
    }
    if (room.live === true && typeof live.busyReview === 'function' && live.busyReview(room.id)) {
      return fail('conflict', '验收员还在看，等结论出来再继续')
    }
    if (note === '') return fail('invalid', '写一句要补的上下文，或要改什么')
    const updated = updateRound(room.id, current => {
      const target = current.stages?.[index]
      if (target === undefined || target.state === STAGE_STATE.pending) return null
      for (let at = index; at < current.stages.length; at += 1) {
        current.stages[at].state = at === index ? STAGE_STATE.active : STAGE_STATE.pending
        if (at === index) current.stages[at].activatedAt = Date.now()
        else delete current.stages[at].activatedAt
      }
      // 后面的阶段重新开始时从当时的 HEAD 取起点；目标步骤自己的起点要保留。
      for (const key of Object.keys(current.stageBases ?? {})) {
        if (Number(key) > index) delete current.stageBases[key]
      }
      for (const key of Object.keys(current.stageBaseManifests ?? {})) {
        if (Number(key) > index) delete current.stageBaseManifests[key]
      }
      current.mergeConflict = null
      current.blocked = null
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
    if (room.live === true && typeof live.reworkStage === 'function') {
      void live.reworkStage(updated, index, note).catch(error => {
        systemNotice({ store, roomId: room.id, text: '退回没能开始；待处理。', error })
      })
    } else {
      appendMessage(room.id, { kind: 'system', text: '已记录退回意见；这个房间现在没有连上，请继续或重新开始。' })
    }
    return ok({ room: updated })
  }

  return { accept, rework, retry, rewind }
}
