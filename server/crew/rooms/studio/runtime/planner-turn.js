// 规划师（lead）这一侧的房间动作：停下/接回/退回、提交方案、换模型、提出问题、
// 首次组队的催问、目标对齐自动通过、验收通过后的系统收口。
// 只回答一件事：这个回合被它处理掉了吗？其余情况交回编排继续。
import { INTERNAL_PROMPT_MARKER } from '../../../internal-prompts.js'
import { memberDisplayName } from '../../../member-labels.js'
import { reworkFloor } from '../../../../../shared/attempt.js'
import { verdictPassed } from '../../../../../shared/judgment.js'
import { OPEN_ROUND_STATUSES, STAGE_STATE } from '../../../../../shared/states.js'
import { askDecisionOf, askQuestionOf, modelAdjustmentOf, resumeRequestOf, rewindRequestOf, stopRequestOf, submitPlanOf } from '../../../../../shared/gate.js'
import { dispatchOf } from '../../../assignment-projections.js'
import { hasLaterWorkStage } from '../acceptance/review-policy.js'
import { systemNotice } from '../../../notices.js'
import { deliverableStageIndex } from './turn-utils.js'
import { leadMemberOf } from '../../../room-members.js'

export const handlePlannerTurn = async (deps) => {
  const {
    store, roomId, emit, state, room, memberId, turn, turnId, calls, role, leadTurn,
    sendToMember, planNudges, resumeRound, adviseStop, rewindStage, applyPlan, adjustModel,
    setMembers, confirmStage, roundOpen,
  } = deps
  const leadId = deps.leadId
    // 控制动作先于一切：停下、接回、退回的回合不再走自动确认和派活。
    if (leadTurn) {
      // 用户的意思是接着做：把停下的一轮接回来；之后的继续由服务层再叫醒一次。
      const resume = resumeRequestOf(calls)
      if (resume !== null && typeof resumeRound === 'function') {
        const result = resumeRound(roomId, resume)
        if (result?.ok === true) {
          store.appendEvent(roomId, 'planner.resume', { roundId: result.body?.round?.id ?? null })
          emit?.('room', store.readRoom(roomId) ?? room)
          state.capturedTurns.add(turnId)
          state.recordTurn(true)
          return
        }
        systemNotice({ store, roomId, text: `继续没成功：${result?.error ?? '再试一次'}` })
      }
      // 规划师的 stop_round 只是建议：系统在安全点停，进行中的回合不打断。
      const stop = stopRequestOf(calls)
      if (stop !== null && typeof adviseStop === 'function') {
        const advice = adviseStop(stop)
        if (advice?.deferred === true) {
          store.appendEvent(roomId, 'planner.stop_deferred', { reason: stop.reason })
        }
        state.capturedTurns.add(turnId)
        state.recordTurn(true)
        return
      }
      const request = rewindRequestOf(calls)
      if (request !== null && typeof rewindStage === 'function') {
        const result = rewindStage(roomId, request)
        if (result?.ok === true) {
          store.appendEvent(roomId, 'planner.rewind', { stage: request.stage, note: request.note })
          emit?.('room', store.readRoom(roomId) ?? room)
          state.capturedTurns.add(turnId)
          state.recordTurn(true)
          return
        }
        systemNotice({ store, roomId, text: `退回没成功：${result?.error ?? '再试一次'}` })
      }
    }
    // 轮次已经不在跑（停下或终态）：迟到的成员回合只记下来，不写证据、不推进。
    if (!roundOpen) {
      state.capturedTurns.add(turnId)
      state.turns.delete(turnId)
      state.recordTurn(false)
      return
    }
    // 规划师交了方案和队伍：平台校验并开通成员，然后由它接上第一步。
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const proposal = submitPlanOf(calls)
      if (proposal !== null && typeof applyPlan === 'function') {
        state.capturedTurns.add(turnId)
        state.recordTurn(true)
        // 补交上方案：上一次“没提交队伍 / 组队没开始”停下的标记到此为止。
        if (['plan', 'setup'].includes(store.readRoom(roomId)?.blocked?.reason)) {
          const cleared = store.updateRound(roomId, current => {
            if (!['plan', 'setup'].includes(current.blocked?.reason)) return null
            current.blocked = null
            return { events: [] }
          })
          if (cleared !== null) emit?.('room', cleared)
        }
        void Promise.resolve(applyPlan(roomId, proposal)).catch(error => {
          systemNotice({ store, roomId, text: '组队没能开始；待处理。', error })
          // 方案没落地就没有人会动：如实停成“等人再试”，别让房间挂着“进行中”。
          const stuck = store.updateRound(roomId, current => {
            const index = Array.isArray(current.stages)
              ? current.stages.findIndex(stage => stage.state === STAGE_STATE.active)
              : -1
            if (index < 0 || current.blocked?.reason === 'setup') return null
            current.blocked = { stage: index, reason: 'setup', at: Date.now() }
            return { events: [{ type: 'stage.blocked', payload: { stage: index, reason: 'setup' } }] }
          })
          if (stuck !== null) emit?.('room', stuck)
        })
        return
      }
    }
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const modelChange = modelAdjustmentOf(calls)
      if (modelChange !== null && typeof adjustModel === 'function') {
        state.capturedTurns.add(turnId)
        state.recordTurn(true)
        void Promise.resolve(adjustModel(roomId, modelChange)).catch(error => {
          systemNotice({ store, roomId, text: '换模型没成功；待处理。', error })
        })
        return
      }
    }
    // 规划师遇到真正的分叉：存一张决策卡，暂停派活，等用户选。
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const activeIndex = (room.stages ?? []).findIndex(stage => stage.state === STAGE_STATE.active)
      const ask = askDecisionOf(calls, {
        id: `decision-${turnId}`,
        roomId,
        roundId: room.activeRoundId ?? null,
        stage: activeIndex >= 0 ? activeIndex : null,
        at: Number.isFinite(turn?.at) ? turn.at : Date.now(),
      })
      if (ask !== null) {
        state.capturedTurns.add(turnId)
        if (room.pendingDecision?.status !== 'open') {
          // 等用户拍板时基座群聊里只留规划师；被移出的人连 @ 都收不到。
          // 对齐开局已经只留规划师，不再重复改名单，免得撞上基座正在跑回合。
          const first = room.stages?.[0]
          const alreadyAlone = first?.title === '目标对齐' && first.state !== STAGE_STATE.passed
          if (!alreadyAlone && typeof setMembers === 'function') void setMembers(roomId, [memberId])
          const updated = store.updateRound(roomId, current => {
            current.pendingDecision = ask
            return { events: [{ type: 'decision.asked', payload: { id: ask.id, stage: ask.stage, question: ask.question } }] }
          })
          if (updated !== null) emit?.('room', updated)
        }
        return
      }
      // 只是缺事实：记一个问题，暂停派活，等用户在下面回答。
      const question = askQuestionOf(calls, { at: Number.isFinite(turn?.at) ? turn.at : Date.now() })
      if (question !== null) {
        state.capturedTurns.add(turnId)
        const open = typeof room.openQuestion === 'string' && room.openQuestion.trim() !== ''
        if (!open && room.pendingDecision?.status !== 'open') {
          const updated = store.updateRound(roomId, current => {
            current.openQuestion = question.text
            return { events: [{ type: 'question.asked', payload: { text: question.text } }] }
          })
          if (updated !== null) emit?.('room', updated)
        }
        return
      }
    }
    // 启动态只有规划师：没有 submit_plan 就没人开工。先私下催一次，第二次收口给人。
    if (role === 'lead' && memberId !== null && memberId === leadMemberOf(room)?.id) {
      const bootstrap = !(room.members ?? []).some(member => (
        member.roleKind === 'executor' || member.role === 'worker'
      ))
      const waiting = (room.openQuestion !== null && room.openQuestion !== undefined && room.openQuestion !== '') ||
        room.pendingDecision?.status === 'open'
      if (bootstrap && room.workRound?.plan == null && !waiting) {
        const key = `plan:${room.activeRoundId ?? ''}`
        state.capturedTurns.add(turnId)
        state.recordTurn(true)
        if (planNudges !== null && planNudges.has(key)) {
          store.appendMessage(roomId, {
            kind: 'system',
            text: '规划师还没有提交队伍；这一轮先停在这里。回一句“继续”再试一次。',
          })
          // 说了停就要真的停：房间仍在“进行中”时，界面和评测都以为有人正在做。
          const updated = store.updateRound(roomId, current => {
            const index = Array.isArray(current.stages)
              ? current.stages.findIndex(stage => stage.state === STAGE_STATE.active)
              : -1
            if (index < 0 || current.blocked?.reason === 'plan') return null
            current.blocked = { stage: index, reason: 'plan', at: Date.now() }
            return { events: [{ type: 'stage.blocked', payload: { stage: index, reason: 'plan' } }] }
          })
          if (updated !== null) emit?.('room', updated)
          return
        }
        planNudges?.add(key)
        if (typeof sendToMember === 'function') {
          void sendToMember(memberId, [
            '你这一回合没有提交方案和队伍。现在只做一件事：调用 lodge_gate_submit_plan 提交阶段、工作包（含 clauseIds）、执行官和验收员；',
            '不要继续分析，不要再问用户。工具确实不可用时只回复一行“组队失败”和原因。',
            INTERNAL_PROMPT_MARKER,
          ].join('\n'), {
            intent: 'align',
            from: '组队流程',
            sendId: `plan-${turnId}`,
          }).catch(error => {
            systemNotice({ store, roomId, text: '没能再叫规划师提交队伍；待处理。', error })
          })
          return
        }
        store.appendMessage(roomId, { kind: 'system', text: '规划师没有提交队伍；待处理。' })
        return
      }
    }
    // 规划师把目标对齐说清楚、又没有留下问题时，对齐这一步自动通过；
    // 这一步没有界面动作，等人只会让零准备开工停在第一屏。
    const alignIndex = room === null ? -1 : room.stages.findIndex(stage => stage.state === STAGE_STATE.active)
    const alignStage = alignIndex >= 0 ? room.stages[alignIndex] : null
    if (
      alignStage?.kind === 'decision' &&
      alignStage?.spine === true &&
      alignStage?.title === '目标对齐' &&
      memberId !== null &&
      memberId === leadMemberOf(room)?.id &&
      // 停下的一轮不再自动确认阶段；只有开着的轮次才往前走。
      OPEN_ROUND_STATUSES.has(room?.workRound?.status ?? 'active') &&
      String(turn?.reply ?? '').trim() !== '' &&
      (room.openQuestion === null || room.openQuestion === undefined || room.openQuestion === '') &&
      // 启动态还没有执行官：对齐由 submit_plan 推进，不在这里自动过。
      (room.members ?? []).some(member => member.roleKind === 'executor' || member.role === 'worker') &&
      typeof confirmStage === 'function'
    ) {
      void Promise.resolve(confirmStage(roomId, alignIndex)).catch(() => {})
    }
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room === null ? null : dispatchOf(store, roomId, stageIndex)
    // 验收已通过、规划师也收过尾：系统收口，不再等人点一次确认。
    const signoffMessages = store.readMessages(roomId)
    const signoffFloor = reworkFloor(signoffMessages, stageIndex)
    const signoffVerdict = [...signoffMessages].reverse()
      .find(message => (
        message.kind === 'verdict' &&
        (message.meta?.stage ?? 0) === stageIndex &&
        (message.seq ?? 0) > signoffFloor
      ))
    if (
      memberId !== null &&
      memberId === leadMemberOf(room)?.id &&
      room?.stages?.[stageIndex]?.state === STAGE_STATE.active &&
      signoffVerdict !== undefined &&
      verdictPassed(signoffVerdict) &&
      !hasLaterWorkStage(room, stageIndex) &&
      typeof confirmStage === 'function'
    ) {
      // 系统收口失败要让人看见：accept 失败时返回 {ok:false}，吞掉它会让一个
      // 已经验收通过的房间永远停在这一步。
      const failure = error => store.appendMessage(roomId, {
        kind: 'system',
        text: '验收已通过，但没能自动收口；待处理。',
        meta: { reason: String(error?.message ?? error ?? '').slice(0, 200) },
      })
      void Promise.resolve(confirmStage(roomId, stageIndex, { by: 'system' }))
        .then(result => {
          if (result !== null && result?.ok === false) return failure(result.error)
          return undefined
        })
        .catch(failure)
    }
  return false
}
