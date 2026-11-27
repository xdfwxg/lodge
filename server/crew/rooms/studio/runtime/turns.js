import { createStageIntegrator } from '../delivery/integration.js'
import { createReviewCoordinator } from '../acceptance/review.js'
import { createHandoff } from '../delivery/handoff.js'
import { createStageStarter } from '../plan/stage.js'
import { createTurnState } from '../plan/turn-state.js'
import { activeDispatchAssignments } from '../../../assignments.js'
import { cancelAssignmentLease } from '../plan/assignment-lease.js'
import { deliverableStageIndex, memberForRef } from './turn-utils.js'
import { createResultMarker } from './result.js'
import { createPlannerRouting } from './planner-decision.js'
import { createTurnCapture } from './turn-capture.js'
import { createResume } from './resume.js'
import { stopAdviceReady } from '../plan/stop-advice.js'
import { systemNotice } from '../../../notices.js'

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, engine = null, roomId, emit, sendToMember, askPlanner = null, files, expireCards = null, writeDiagnostic = null, confirmStage = null, applyPlan = null, adjustModel = null, rewindStage = null, stopRound = null, resumeRound = null, screenshots = null, attachments = null, setMembers = null, runCommand = null }) => {
  const state = createTurnState({ store, roomId, emit })
  // 接上房间时如果卡还开着，基座群聊只留规划师；其余成员等第一次派活再放回。
  const syncDecisionMembers = () => {
    const room = store.readRoom(roomId)
    if (room?.pendingDecision?.status !== 'open') return
    const ids = (room.members ?? []).filter(member => member.role === 'lead').map(member => member.id)
    if (ids.length > 0 && typeof setMembers === 'function') void setMembers(roomId, ids)
  }
  syncDecisionMembers()
  // 第一个活动就说明成员已经在做活；成员级计时到此为止，后面的长回合交给阶段截止。
  const trackTool = message => {
    state.trackTool(message)
    if (message?.kind !== 'activity') return
    const room = store.readRoom(roomId)
    if (room === null) return
    const memberId = memberForRef(room, message.authorRef)
    if (memberId === null) return
    const stageIndex = deliverableStageIndex(room)
    const active = activeDispatchAssignments(store, roomId, stageIndex)
      .filter(item => item.toMemberId === memberId && ['sent', 'working'].includes(item.status))
    if (active.length === 1) cancelAssignmentLease({ store, roomId, assignmentId: active[0].id })
  }
  // 超时停人：状态判了“已停止”，进程也要真的停；找不到运行中的回合就当已经停了。
  const interruptMember = memberId => {
    const room = store.readRoom(roomId)
    const ref = (room?.members ?? []).find(member => member.id === memberId)?.body?.ref
    if (typeof ref !== 'string' || ref === '') return
    if (typeof engine?.interruptBot !== 'function') return
    void engine.interruptBot(ref, {}).catch(() => {})
  }
  const handoff = createHandoff({ store, roomId, sendToMember, emit })
  const review = createReviewCoordinator({
    store,
    roomId,
    emit,
    sendToMember,
    handoff,
    previews: screenshots,
    attachments,
    // 中间步骤验收通过就自动收口；最后一步仍走人的确认。
    advanceStage: confirmStage,
    ...(runCommand === null ? {} : { runCommand }),
  })
  const plannerNudges = new Set()
  const planNudges = new Set()
  const result = createResultMarker({
    store,
    roomId,
    review,
    markProgress: state.markProgress,
    filePort: files,
  })
  const integrator = createStageIntegrator({
    store,
    roomId,
    emit,
    markProgress: state.markProgress,
    requestReview: review.request,
  })
  const stageStarter = createStageStarter({
    store,
    roomId,
    emit,
    handoff,
    askPlanner,
    integrate: integrator.integrate,
    enqueue: integrator.enqueue,
    interrupt: interruptMember,
  })
  const pendingTimers = new Set()
  const schedule = (fn, ms) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer)
      fn()
    }, ms)
    timer.unref?.()
    pendingTimers.add(timer)
    return timer
  }

  const routePlannerDecision = createPlannerRouting({ store, roomId, sendToMember, handoff, plannerNudges, schedule, expireCards })

  // 规划师的停止是建议：没有进行中的执行/复核时才真正停，正在跑的回合不打断。
  let stopping = false
  const maybeStop = () => {
    if (stopping) return { ok: false, deferred: true }
    if (typeof stopRound !== 'function') return { ok: false }
    const room = store.readRoom(roomId)
    const advice = room?.stopAdvice ?? room?.workRound?.stopAdvice
    if (advice === undefined || advice === null) return { ok: false }
    const stageIndex = deliverableStageIndex(room)
    const assignments = activeDispatchAssignments(store, roomId, stageIndex)
    if (!stopAdviceReady({ assignments, reviewBusy: review.isBusy() })) return { ok: false, deferred: true }
    stopping = true
    const settle = stopped => {
      stopping = false
      if (stopped?.ok === true) {
        store.updateRound(roomId, current => {
          current.stopAdvice = null
          return { events: [] }
        })
      }
      return stopped ?? { ok: false }
    }
    try {
      return Promise.resolve(stopRound(roomId, { reason: advice.reason })).then(settle).catch(error => {
        stopping = false
        systemNotice({ store, roomId, text: '停止没成功，再试一次。', error })
        return { ok: false }
      })
    } catch (error) {
      stopping = false
      systemNotice({ store, roomId, text: '停止没成功，再试一次。', error })
      return { ok: false }
    }
  }

  const adviseStop = advice => {
    const room = store.readRoom(roomId)
    const stageIndex = deliverableStageIndex(room)
    store.appendMessage(roomId, {
      kind: 'system',
      text: `规划师建议停下：${advice.reason}。系统会在没有进行中的执行和复核时停住。`,
    })
    store.updateRound(roomId, current => {
      current.stopAdvice = { reason: advice.reason, stage: stageIndex, at: Date.now() }
      return { events: [{ type: 'planner.stop_advice', payload: { stage: stageIndex, reason: advice.reason } }] }
    })
    return maybeStop()
  }

  const capture = createTurnCapture({ store, roomId, emit, files, state, integrator, review, routePlannerDecision, markResultReady: result.markResultReady, confirmStage, applyPlan, adjustModel, rewindStage, adviseStop, resumeRound, writeDiagnostic, setMembers, sendToMember, planNudges })

  // 每个回合结束后都看一眼：建议停下的那一轮，等最后一位在跑的成员交回后再停。
  const captureTurn = (...args) => {
    const captured = capture(...args)
    if (captured !== null && typeof captured?.then === 'function') {
      return captured.finally(() => { void maybeStop() })
    }
    void maybeStop()
    return captured
  }

  // 服务重启后以已落盘的消息为准续跑：缺回合就重新派发，待复核就重发请求，待集成就先合并。
  const resumeOnce = createResume({ store, roomId, emit, sendToMember, integrator, review, stageStarter, markResultReady: result.markResultReady })

  const resume = async options => {
    try {
      await resumeOnce(options)
    } catch (error) {
      systemNotice({ store, roomId, text: '上次没做完的这一步没能继续；待处理。', error })
    }
  }

  const dispose = () => {
    stageStarter.dispose?.()
    for (const timer of pendingTimers) clearTimeout(timer)
    pendingTimers.clear()
    plannerNudges.clear()
    planNudges.clear()
  }

  return {
    seed: state.seed,
    trackTool,
    captureTurn,
    adviseStop,
    maybeStop,
    resume,
    requestReview: review.request,
    resolveMerged: integrator.resolve,
    startStage: stageStarter.startStage,
    watchStageTimeout: stageStarter.watchStageTimeout,
    expireStage: stageStarter.timeoutStage,
    expireAssignment: stageStarter.expireAssignment,
    busyReview: review.isBusy,
    dispose,
  }
}
