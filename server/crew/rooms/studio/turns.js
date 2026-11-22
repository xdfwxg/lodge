import { createAcceptanceRunner } from './acceptance-runner.js'
import { createStageIntegrator } from './integration.js'
import { createReviewCoordinator } from './review.js'
import { createHandoff } from './handoff.js'
import { createStageStarter } from './stage.js'
import { createTurnState } from './turn-state.js'
import { activeDispatchAssignments } from '../../assignments.js'
import { cancelAssignmentLease } from './assignment-lease.js'
import { deliverableStageIndex, memberForRef } from './turn-utils.js'
import { createAutoCheck } from './runtime/auto-check.js'
import { createPlannerRouting } from './runtime/planner-decision.js'
import { createTurnCapture } from './runtime/turn-capture.js'
import { createResume } from './runtime/resume.js'
import { systemNotice } from '../../notices.js'

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, roomId, emit, sendToMember, askPlanner = null, commands, files, shadow = null, expireCards = null, writeDiagnostic = null, confirmStage = null, rewindStage = null, screenshots = null, attachments = null }) => {
  const state = createTurnState({ store, roomId, emit })
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
  const handoff = createHandoff({ store, roomId, sendToMember, emit })
  const review = createReviewCoordinator({
    store,
    roomId,
    emit,
    sendToMember,
    handoff,
    shadow,
    previews: screenshots,
    attachments,
    // 中间步骤验收通过就自动收口；最后一步仍走人的确认。
    advanceStage: confirmStage,
  })
  const autoLoops = new Map()
  const plannerNudges = new Set()
  let auto = null
  const acceptance = createAcceptanceRunner({
    store,
    roomId,
    emit,
    markProgress: state.markProgress,
    requestReview: review.request,
    run: commands.run,
    onAutoPass: ({ stageIndex }) => {
      autoLoops.delete(stageIndex)
      auto?.setAutoCheck(stageIndex, null)
    },
    onAutoFail: info => auto?.autoRework(info),
  })
  const integrator = createStageIntegrator({
    store,
    roomId,
    emit,
    markProgress: state.markProgress,
    requestReview: review.request,
    run: commands.run,
  })
  const stageStarter = createStageStarter({
    store,
    roomId,
    emit,
    handoff,
    askPlanner,
    integrate: integrator.integrate,
    enqueue: integrator.enqueue,
  })
  const autoChecks = new Set()
  const noCheckNoted = new Set()
  auto = createAutoCheck({
    store,
    roomId,
    emit,
    files,
    acceptance,
    review,
    stageStarter,
    state,
    expireCards,
    autoLoops,
    autoChecks,
    noCheckNoted,
  })
  const { autoCheck, markManualReady } = auto
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

  const captureTurn = createTurnCapture({ store, roomId, emit, files, state, integrator, review, acceptance, routePlannerDecision, autoCheck, markManualReady, confirmStage, rewindStage, writeDiagnostic })

  // 服务重启后以已落盘的消息为准续跑：缺回合就重新派发，缺验收就重跑命令，待复核就重发请求，待集成就先合并。
  const resumeOnce = createResume({ store, roomId, emit, sendToMember, integrator, review, acceptance, stageStarter, markManualReady })

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
    autoLoops.clear()
    plannerNudges.clear()
    autoChecks.clear()
    noCheckNoted.clear()
  }

  return {
    seed: state.seed,
    trackTool,
    captureTurn,
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
