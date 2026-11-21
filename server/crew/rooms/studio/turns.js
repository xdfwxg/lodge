import { createAcceptanceRunner } from './acceptance-runner.js'
import { createStageIntegrator } from './integration.js'
import { createReviewCoordinator } from './review.js'
import { createHandoff } from './handoff.js'
import { createStageStarter } from './stage.js'
import { createTurnState } from './turn-state.js'
import { createAutoCheck } from './runtime/auto-check.js'
import { createPlannerRouting } from './runtime/planner-decision.js'
import { createTurnCapture } from './runtime/turn-capture.js'
import { createResume } from './runtime/resume.js'
import { systemNotice } from '../../notices.js'

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, roomId, emit, sendToMember, askPlanner = null, commands, files, shadow = null, expireCards = null, writeDiagnostic = null, confirmStage = null, rewindStage = null, screenshots = null, attachments = null }) => {
  const state = createTurnState({ store, roomId, emit })
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
    trackTool: state.trackTool,
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
