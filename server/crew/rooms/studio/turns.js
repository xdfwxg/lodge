import { createHash } from 'node:crypto'
import { addTurnUsage } from '../../../../shared/usage.js'
import { assessTurn } from '../../turn-assessment.js'
import { memberDisplayName } from '../../member-labels.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { reviewState } from './verifiers.js'
import { createAcceptanceRunner } from './acceptance-runner.js'
import { createStageIntegrator } from './integration.js'
import { createReviewCoordinator } from './review.js'
import { createHandoff } from './handoff.js'
import { createStageStarter } from './stage.js'
import { createTurnState } from './turn-state.js'
import { deliverableStageIndex, isWorkStage, memberForRef } from './turn-utils.js'
import { judgmentAnchorOf, judgmentOf, normalizeJudgment, verdictPassed } from '../../../../shared/judgment.js'
import { gateSubmissionOf } from '../../../../shared/gate.js'
import { activeDispatchAssignments as activeDispatch, assignmentForTurn, latestDispatchAssignment, transitionAssignment, updateAssignment } from '../../assignments.js'
import { dispatchOf } from '../../assignment-projections.js'
import { leadMemberOf, memberOf, verifierIds, workerIds } from '../../room-members.js'
import { vcsOf, workspaceOf } from './workspace.js'
import { settleCompletedSubrooms } from './subrooms.js'
import { detectCheckCommand } from '../../project-checks.js'
import { systemNotice } from '../../notices.js'
import { MAX_AUTO_REWORKS, checkLedger, nextAutoRework } from './auto-rework.js'

const MAX_STAGE_REWORKS = 3

// 实时房间的回合副作用：证据捕获、验收命令、复核请求。
export const createLiveTurns = ({ store, roomId, emit, sendToMember, askPlanner = null, commands, files, shadow = null, expireCards = null, writeDiagnostic = null, confirmStage = null }) => {
  const state = createTurnState({ store, roomId, emit })
  const handoff = createHandoff({ store, roomId, sendToMember, emit })
  const review = createReviewCoordinator({ store, roomId, emit, sendToMember, handoff, shadow })
  const autoLoops = new Map()
  const plannerNudges = new Set()
  const acceptance = createAcceptanceRunner({
    store,
    roomId,
    emit,
    markProgress: state.markProgress,
    requestReview: review.request,
    run: commands.run,
    onAutoPass: ({ stageIndex }) => {
      autoLoops.delete(stageIndex)
      setAutoCheck(stageIndex, null)
    },
    onAutoFail: info => autoRework(info),
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

  // 自动检查没通过就退回重做，带着失败输出和影子评审的另一个角度；
  // 原地打转、次数、时间或额度触顶就停手，交给人决定。
  const shadowAdviceText = (room, stageIndex) => {
    const entry = room.advisorShadow?.[stageIndex]
    const advice = Array.isArray(entry?.advice) ? entry.advice[0] : null
    if (advice === null || typeof advice !== 'object') return ''
    const lines = [
      typeof advice.summary === 'string' ? advice.summary : '',
      ...(Array.isArray(advice.risks) ? advice.risks.map(item => `风险：${item}`) : []),
      ...(Array.isArray(advice.missingEvidence) ? advice.missingEvidence.map(item => `缺证据：${item}`) : []),
    ].filter(Boolean).slice(0, 5)
    return lines.length === 0 ? '' : `影子评审的另一个角度（仅供参考）：\n${lines.join('\n')}`
  }

  const stopAutoRework = ({ stageIndex, reason, status, attempts }) => {
    const text = reason === 'same-failure'
      ? '这一步没做成：同一处失败反复出现，重做也没绕开。需要你决定下一步。'
      : reason === 'time'
        ? '这一步还没做成：自动检查到时间上限就先停了。可以再试一次，或自己处理。'
        : reason === 'budget'
          ? '这一步先停下了：房间额度用完了。结果和失败输出都还在房间里。'
          : '这一步没做成：自动检查试了几次都没通过。需要你决定下一步。'
    store.appendMessage(roomId, { kind: 'system', text, meta: { autoCheckStop: status } })
    store.appendEvent(roomId, 'auto_rework.stopped', { stage: stageIndex, reason, status, attempts })
    setAutoCheck(stageIndex, { status, reason, attempts })
  }

  // 停止状态记在房间里：界面只说人话，次数和原因留在记录里备查。
  const setAutoCheck = (stageIndex, patch) => {
    const updated = store.updateRoom(roomId, current => {
      if (patch === null) {
        if (current.autoCheck?.stage !== stageIndex) return null
        delete current.autoCheck
        return { events: [] }
      }
      current.autoCheck = {
        stage: stageIndex,
        maxAttempts: MAX_AUTO_REWORKS,
        at: Date.now(),
        ...(current.autoCheck?.stage === stageIndex ? current.autoCheck : {}),
        ...patch,
      }
      return { events: [{ type: 'room.auto_check', payload: { stage: stageIndex, status: patch.status, attempts: patch.attempts ?? 0 } }] }
    })
    if (updated !== null) emit?.('room', updated)
    return updated
  }

  // 房间记录就是进度账本：重做时把前几次试过什么一并带上，不只看见最后一次失败。
  const autoLedger = stageIndex => {
    const prior = store.readMessages(roomId)
      .filter(message => (
        message.kind === 'evidence' &&
        message.meta?.auto === true &&
        (message.meta?.stage ?? 0) === stageIndex
      ))
      .slice(0, -1)
    return checkLedger(prior, { startAt: Math.max(1, prior.length - 2) })
  }

  const autoRework = async ({ stageIndex, command, exit, output }) => {
    const room = store.readRoom(roomId)
    if (room === null || room.state !== 'active') return
    if (room.mergeConflict?.stage === stageIndex) return
    const stage = room.stages?.[stageIndex]
    if (stage === undefined || stage.state !== 'active' || stage.manual !== true) return
    if ((room.busyMembers ?? []).length > 0) return
    const decision = nextAutoRework({ state: autoLoops.get(stageIndex), command, exit, output, room })
    autoLoops.set(stageIndex, decision.state)
    if (decision.retry !== true) {
      stopAutoRework({ stageIndex, reason: decision.reason, status: decision.status, attempts: decision.state.attempts })
      return
    }
    const tail = String(output ?? '').trim().slice(-1500)
    const note = [
      autoLedger(stageIndex),
      `自动检查没通过（第 ${decision.state.attempts} 次）：${command}（退出码 ${exit}）。`,
      tail,
      shadowAdviceText(room, stageIndex),
    ].filter(Boolean).join('\n')
    store.appendMessage(roomId, {
      kind: 'rework',
      authorId: 'system',
      text: '自动检查没通过，已重做这一步。',
      meta: { stage: stageIndex, source: 'auto', note },
    })
    if (typeof expireCards === 'function') expireCards()
    try {
      await stageStarter.startStage(room, stageIndex, { note, rework: true })
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步没能自动重做；需要你处理。', error })
    }
  }

  // 产品自己保证检查：仓库里有能跑的检查就跑，认不出来就说清楚，不拿空命令问人。
  const autoCheck = (room, stageIndex, turnId) => {
    const key = `${stageIndex}:${turnId}`
    if (autoChecks.has(key)) return
    autoChecks.add(key)
    const detected = detectCheckCommand(files, room.repoPath)
    if (detected === null) {
      if (!noCheckNoted.has(stageIndex)) {
        noCheckNoted.add(stageIndex)
        store.appendMessage(roomId, {
          kind: 'system',
          text: `第 ${stageIndex + 1} 步没有可自动运行的检查；需要你看过结果后确认。`,
          meta: { autoCheckStop: 'needs-input' },
        })
        setAutoCheck(stageIndex, { status: 'needs-input', reason: 'no-check', attempts: 0 })
      }
      return
    }
    void acceptance.run(stageIndex, detected.command, turnId, { auto: true, reason: detected.reason })
  }

  const markManualReady = (room, stageIndex, turnId, worked) => {
    let candidate = null
    try {
      if (workspaceOf(room).capabilities().candidate === true) {
        candidate = workspaceOf(room).submit({ path: room.repoPath, turnId, name: room.name })
        if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage: stageIndex, turnId, commit: candidate })
      }
    } catch (error) {
      systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
    }
    const head = typeof workspaceOf(room).head === 'function' && typeof room.repoPath === 'string' && room.repoPath !== ''
      ? workspaceOf(room).head({ path: room.repoPath })
      : null
    const acceptedRef = candidate ?? head
    const baseline = room.stageBases?.[stageIndex] ?? null
    const files = acceptedRef !== null && baseline !== null && typeof workspaceOf(room).changedFilesSince === 'function'
      ? workspaceOf(room).changedFilesSince({ path: room.repoPath, base: baseline })
      : []
    // 人工阶段没有命令可判“无改动”：同一 HEAD 上的重复回合不重复生成验收证据，也不重复送审。
    const prior = [...store.readMessages(roomId)].reverse().find(message => (
      message.kind === 'evidence' &&
      message.meta?.kind === 'manual' &&
      (message.meta?.stage ?? 0) === stageIndex
    ))
    const covered = prior?.meta?.candidate ?? prior?.meta?.head ?? null
    if (prior !== undefined) {
      if (covered !== null && acceptedRef !== null && covered === acceptedRef) return
      if (!worked && covered === null) return
    }
    const hasVerifier = verifierIds(room).length > 0
    store.appendMessage(roomId, {
      kind: 'evidence',
      authorId: 'system',
      text: hasVerifier ? '结果已经好了，等验收员复核。' : '结果已经好了，可以验收了。',
      meta: {
        kind: 'manual',
        stage: stageIndex,
        turnId,
        candidate,
        head: typeof acceptedRef === 'string' && acceptedRef !== '' ? acceptedRef : null,
        files,
        changedFiles: files,
        repoPath: room.repoPath,
        simulated: false,
        capturedAt: new Date().toISOString(),
      },
    })
    store.appendMessage(roomId, { kind: 'system', text: hasVerifier ? '结果已经好了 · 等验收员复核' : '结果已经好了 · 可以验收了' })
    state.markProgress()
    if (hasVerifier) {
      void review.request(stageIndex).catch(error => {
        systemNotice({ store, roomId, text: '结果已经好了，但没能叫验收员来看；需要你处理。', error })
      })
    }
  }

  // 退回后规划师的第一行是决定；系统按它转交，不依赖模型是否写出可唤醒的 @。
  const routePlannerDecision = (room, stageIndex, turn, calls = []) => {
    const messages = store.readMessages(roomId)
    const latestVerdict = [...messages].reverse()
      .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === stageIndex)
    if (latestVerdict === undefined || judgmentOf(latestVerdict)?.decision !== 'reject') return false
    const verdictIndex = messages.indexOf(latestVerdict)
    if (messages.slice(verdictIndex + 1).some(message => (
      message.kind === 'evidence' && (message.meta?.stage ?? 0) === stageIndex
    ))) return false
    const verdictId = latestVerdict.id ?? latestVerdict.seq
    if (room.lastPlannerDecision?.verdictId === verdictId) return false

    const lead = leadMemberOf(room)?.id
    const gateJudgment = gateSubmissionOf(calls, {
      type: 'planner',
      stage: stageIndex,
      actorId: lead,
    })
    const anchor = gateJudgment === null ? judgmentAnchorOf('planner', turn.reply) : null
    const nudgeKey = `${stageIndex}:${verdictId}`
    const settleMissing = () => {
      const current = store.readRoom(roomId)
      if (current === null || current.lastPlannerDecision?.verdictId === verdictId) return
      const missing = {
        version: 1,
        type: 'planner',
        decision: 'human',
        reason: '规划师没有提交决定，房间先把这一步交给你。',
        findings: [],
        actionRequired: '规划师没有提交决定；请决定这一步是重做，还是由你接手。',
        stage: stageIndex,
        evidenceId: null,
        actorId: lead ?? null,
        rejectTo: 'human',
        at: Date.now(),
        source: 'missing',
      }
      store.updateRoom(roomId, roomState => {
        roomState.lastPlannerDecision = {
          stage: stageIndex,
          verdictId,
          kind: 'human',
          judgment: missing,
          at: Date.now(),
        }
        return { events: [] }
      })
      for (const item of activeDispatch(store, roomId, stageIndex)) {
        transitionAssignment(store, item.id, 'rejected', { resultText: '规划师没有提交决定，已交给人' })
      }
      store.appendMessage(roomId, { kind: 'system', text: '规划师没有提交决定，已把这一步交给你处理。' })
    }
    // 没有工具提交、首行也不是「返工/交给人」：先催它只提交决定，再收口给人，不猜。
    if (gateJudgment === null && anchor === null) {
      if (plannerNudges.has(nudgeKey)) {
        settleMissing()
        return true
      }
      plannerNudges.add(nudgeKey)
      if (typeof lead !== 'string' || lead === '' || typeof sendToMember !== 'function') {
        settleMissing()
        return true
      }
      void sendToMember(lead, [
        '你这一回合没有提交决定。现在只做一件事：调用 lodge_gate_submit_decision 提交「返工」或「交给人」；',
        '工具确实不可用时只回复一行「返工」或「交给人」。不要继续调研，也不要改文件。',
        INTERNAL_PROMPT_MARKER,
      ].join('\n'), {
        intent: 'decision',
        from: '验收流程',
        sendId: `n-${createHash('sha1').update(nudgeKey).digest('hex').slice(0, 32)}`,
      }).catch(error => {
        systemNotice({ store, roomId, text: '没能再叫规划师提交决定；稍后会把这一步交给你。', error })
      })
      const timer = setTimeout(settleMissing, 120_000)
      timer.unref?.()
      return true
    }
    const submitted = gateJudgment ?? normalizeJudgment({
      type: 'planner',
      text: turn.reply,
      stage: stageIndex,
      actorId: lead,
    })
    // 返工预算按这一步实际发生过的重做次数算；用完就交给人，不再无限重跑。
    const reworksUsed = messages.filter(message => (
      message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex
    )).length
    const judgment = submitted.rejectTo === 'worker' && reworksUsed >= MAX_STAGE_REWORKS
      ? {
        version: 1,
        type: 'planner',
        decision: 'human',
        reason: `这一步已经返工 ${reworksUsed} 次，返工预算用完了。`,
        findings: [],
        actionRequired: '返工预算已经用完；请决定继续返工、改目标，还是由你接手。',
        stage: stageIndex,
        evidenceId: null,
        actorId: lead ?? null,
        rejectTo: 'human',
        at: Date.now(),
        source: 'policy',
      }
      : submitted
    store.updateRoom(roomId, current => {
      current.lastPlannerDecision = { stage: stageIndex, verdictId, kind: judgment.decision, judgment, at: Date.now() }
      return { events: [] }
    })
    // 合并冲突要人拍板；规划师自动返工会把冲突清掉，等于替人做了决定。
    if (room.mergeConflict?.stage === stageIndex) return true
    const stage = room.stages?.[stageIndex]
    if (judgment.rejectTo !== 'worker') {
      // 交给人是这一步的当前收口：执行交接不再挂着，等人的决定。
      for (const item of activeDispatch(store, roomId, stageIndex)) {
        transitionAssignment(store, item.id, 'rejected', {
          resultText: judgment.reason === '' ? '规划师把这一步交给人' : `交给人：${judgment.reason}`,
        })
      }
      return true
    }
    // 并行阶段的重做要送进每一位执行成员的工作副本；只叫一个人会把另一条分支留在旧结果上。
    const assignees = (Array.isArray(stage?.assignees) ? stage.assignees : [])
      .filter(id => workerIds(room).includes(id))
    const targets = assignees.length > 0 ? assignees : workerIds(room)
    if (targets.length === 0) {
      store.appendMessage(roomId, { kind: 'system', text: '这一步没有执行成员，规划师没法把重做交出去。' })
      return true
    }
    const parents = new Map()
    for (const target of targets) {
      const parent = latestDispatchAssignment(store, roomId, stageIndex, target)
      parents.set(target, parent)
      if (parent !== null) transitionAssignment(store, parent.id, 'failed', { resultText: '验收退回，规划师安排重做' })
    }
    const parallel = targets.length > 1
    const note = judgment.reason
    store.appendMessage(roomId, {
      kind: 'rework',
      authorId: 'system',
      text: '验收退回，规划师安排重做。',
      meta: { stage: stageIndex, source: 'planner', note, verdictId, judgment },
    })
    if (typeof expireCards === 'function') expireCards()
    for (const target of targets) {
      const name = memberDisplayName(room, target)
      const addressed = !parallel && String(turn.reply ?? '').includes(`@${name}`)
      void handoff.trigger({
        room,
        stage,
        index: stageIndex,
        from: leadMemberOf(room)?.id,
        to: target,
        reason: 'rework',
        prompt: `${note}\n${INTERNAL_PROMPT_MARKER}`,
        message: note,
        visible: false,
        deliver: parallel ? true : !addressed,
        ...(parallel ? { privateRoom: true } : {}),
        acceptance: stage?.acceptance ?? '',
        rework: true,
        parentAssignmentId: parents.get(target)?.id ?? null,
      }).catch(error => {
        systemNotice({ store, roomId, text: `重做没能交给${name}；需要你处理。`, error })
      })
    }
    return true
  }

  const captureTurn = (turn, authorRef) => {
    const turnId = turn?.turnId
    if (typeof turnId !== 'string' || state.capturedTurns.has(turnId)) return
    if (turn?.usage !== undefined && turn?.usage !== null) {
      store.updateRoom(roomId, current => {
        const usage = addTurnUsage(current.usage, turn.usage)
        if (usage === null) return null
        current.usage = usage
        return { events: [] }
      })
    }
    const room = store.readRoom(roomId)
    const memberId = memberForRef(room, authorRef)
    const role = memberOf(room, memberId)?.role
    // 规划师把目标对齐说清楚、又没有留下问题时，对齐这一步自动通过；
    // 这一步没有界面动作，等人只会让零准备开工停在第一屏。
    const alignIndex = room === null ? -1 : room.stages.findIndex(stage => stage.state === 'active')
    const alignStage = alignIndex >= 0 ? room.stages[alignIndex] : null
    if (
      alignStage?.kind === 'decision' &&
      alignStage?.spine === true &&
      alignStage?.title === '目标对齐' &&
      memberId !== null &&
      memberId === leadMemberOf(room)?.id &&
      String(turn?.reply ?? '').trim() !== '' &&
      (room.openQuestion === null || room.openQuestion === undefined || room.openQuestion === '') &&
      typeof confirmStage === 'function'
    ) {
      void Promise.resolve(confirmStage(roomId, alignIndex)).catch(() => {})
    }
    const stageIndex = room === null ? 0 : deliverableStageIndex(room)
    const dispatch = room === null ? null : dispatchOf(store, roomId, stageIndex)
    const assignment = memberId === null || room === null
      ? null
      : assignmentForTurn(store, roomId, stageIndex, memberId, turnId)
    const parallel = (dispatch?.workers?.length ?? 0) > 1
    const writeTurnDiagnostic = (outcome, extra = {}) => {
      if (typeof writeDiagnostic !== 'function' || room === null) return
      try {
        const diagnostic = {
          version: 2,
          roomId,
          roomName: room.name,
          stage: stageIndex,
          stageTitle: room.stages?.[stageIndex]?.title ?? '',
          memberId,
          role,
          turnId,
          at: turn?.at ?? null,
          durationMs: turn?.durationMs ?? null,
          toolCalls: turn?.toolCalls ?? 0,
          tools: Array.isArray(turn?.tools) ? turn.tools : [],
          usage: turn?.usage ?? null,
          hookCoverage: turn?.hookCoverage ?? null,
          outcome,
          assessment: assessTurn({ outcome, turn, extra }),
          ...extra,
        }
        void Promise.resolve(writeDiagnostic(room, turnId, diagnostic)).catch(() => {})
        store.updateRoom(roomId, current => {
          current.stageDiagnostics = {
            ...(current.stageDiagnostics ?? {}),
            [stageIndex]: {
              at: diagnostic.at ?? Date.now(),
              memberId,
              outcome,
              turnId,
              assessment: diagnostic.assessment,
            },
          }
          return { events: [] }
        })
      } catch {}
    }
    writeTurnDiagnostic('captured')
    const pendingForMember = role === 'worker' &&
      assignment !== null &&
      ['created', 'sent', 'working'].includes(assignment.status) &&
      assignment.context?.parallel === true
    // 旧尝试的回合可能在新一次派发之后才回来；开始时间早于当前交接就丢弃，别污染新结果。
    const startedAt = Number.isFinite(turn?.at) && Number.isFinite(turn?.durationMs)
      ? turn.at - turn.durationMs
      : null
    if (
      role === 'worker' &&
      assignment !== null &&
      startedAt !== null &&
      Number.isFinite(assignment.sentAt) &&
      startedAt < assignment.sentAt - 5000
    ) {
      state.capturedTurns.add(turnId)
      writeTurnDiagnostic('stale', { startedAt, sentAt: assignment.sentAt })
      store.appendEvent(roomId, 'turn.stale', {
        turnId,
        memberId,
        stage: stageIndex,
        startedAt,
        sentAt: assignment.sentAt,
      })
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${memberDisplayName(room, memberId)} 的旧回合结果已忽略；这一步已经重开。`,
      })
      return
    }

    if ((turn.toolCalls ?? 0) === 0 && (turn.reply ?? '') === '') {
      writeTurnDiagnostic('empty')
      if (pendingForMember) {
        state.capturedTurns.add(turnId)
        if (assignment !== null) transitionAssignment(store, assignment.id, 'failed', { resultText: '没有产出' })
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${memberDisplayName(room, memberId)} 这一回合没有产出；继续等其它成员。`,
        })
        const done = integrator.settle(memberId, turnId, true)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            systemNotice({ store, roomId, text: '这一步没有产出；需要你处理。' })
            for (const item of activeDispatch(store, roomId, done.stageIndex)) {
              updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), stalled: true } })
            }
            emit?.('room', store.readRoom(roomId))
          } else {
            void integrator.enqueue(() => integrator.integrate({ ...done, workers: remaining, turnId }))
          }
        }
      }
      return
    }
    state.capturedTurns.add(turnId)
    const calls = state.turns.get(turnId) ?? []
    state.turns.delete(turnId)

    if (review.consume({ turn, memberId, turnId, room, calls })) {
      writeTurnDiagnostic('review')
      state.recordTurn(true)
      return
    }

    store.appendEvent(roomId, 'turn.completed', { turnId, memberId: memberId ?? 'unknown' })
    if (role === 'lead' && routePlannerDecision(room, stageIndex, turn, calls)) {
      writeTurnDiagnostic('decision')
      state.recordTurn(false)
      return
    }
    if (role !== 'worker') {
      writeTurnDiagnostic('ignored')
      state.recordTurn(false)
      return
    }

    const stage = stageIndex

    const artifacts = []
    for (const call of calls) {
      let input
      try {
        input = JSON.parse(call.input ?? '{}')
      } catch {
        continue
      }
      const filePath = input.file_path
      if (typeof filePath !== 'string' || !files.exists(filePath)) continue
      if (artifacts.some(item => item.path === filePath)) continue
      const content = files.read(filePath)
      artifacts.push({
        path: filePath,
        bytes: content.length,
        sha256: createHash('sha256').update(content).digest('hex'),
        content: content.length > 16_384
          ? `${content.subarray(0, 16_384).toString('utf8')}\n…`
          : content.toString('utf8'),
      })
    }

    const worked = (turn.toolCalls ?? 0) > 0 || artifacts.length > 0
    const toolSummary = (turn.tools ?? []).map(tool => `${tool.name} ×${tool.count}${tool.failed ? ` (${tool.failed} 失败)` : ''}`)
    const summary = [
      toolSummary.length > 0 ? `工具：${toolSummary.join(' · ')}` : '工具：无',
      `回合：${((turn.durationMs ?? 0) / 1000).toFixed(1)}s`,
    ].join(' · ')
    const evidence = {
      kind: 'evidence',
      authorId: memberId ?? 'worker',
      text: turn.reply || summary,
      meta: {
        kind: 'turn',
        vcs: vcsOf(room),
        stage,
        turnId,
        summary,
        durationMs: turn.durationMs,
        files: artifacts.map(item => item.path.split('/').at(-1)),
        artifacts,
        output: JSON.stringify({
          tools: turn.tools ?? [],
          toolCalls: turn.toolCalls,
          hookCoverage: turn.hookCoverage,
        }, null, 2),
        capturedAt: new Date().toISOString(),
      },
    }

    if (parallel) {
      void integrator.enqueue(async () => {
        const current = store.readRoom(roomId)
        if (current === null) return
        const worktree = current.worktrees?.[memberId]
        let candidate = null
        if (worktree !== undefined && workspaceOf(current).capabilities().candidate === true) {
          try {
            candidate = workspaceOf(current).submit({ path: worktree, turnId, name: current.name })
            if (candidate !== null) store.appendEvent(roomId, 'room.candidate', { stage, turnId, memberId, commit: candidate })
          } catch (error) {
            systemNotice({ store, roomId, text: '这一步没法准备检查；结果由你确认。', error })
          }
        }
        const base = dispatch?.stage === stage && typeof dispatch.base === 'string'
          ? dispatch.base
          : workspaceOf(current).head({ path: current.repoPath })
        const range = worktree === undefined
          ? { diff: '', files: [] }
          : await workspaceOf(current).rangeChanges({ path: worktree, base })
        const head = worktree === undefined ? '' : workspaceOf(current).head({ path: worktree })
        const stored = store.appendMessage(roomId, {
          ...evidence,
          meta: {
            ...evidence.meta,
            repoPath: worktree ?? '',
            branch: current.branches?.[memberId] ?? '',
            head,
            diff: range.diff,
            manifest: range.manifest ?? [],
            changedFiles: range.files,
            candidate,
          },
        })
        if (assignment !== null) transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [stored.id], ...(candidate === null ? {} : { candidate }) })
        writeTurnDiagnostic('evidence', {
          evidenceIds: [stored.id],
          assignmentId: assignment?.id ?? null,
          candidate,
        })
        store.appendEvent(roomId, 'turn.evidence', { stage, turnId, memberId })
        state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

        const done = integrator.settle(memberId, turnId, false)
        if (done !== null) {
          const remaining = done.workers.filter(worker => !done.failed.includes(worker))
          if (remaining.length === 0) {
            systemNotice({ store, roomId, text: '这一步没有可合并的结果；需要你处理。' })
          } else {
            await integrator.integrate({ ...done, workers: remaining, turnId })
          }
          return
        }
        if (pendingForMember) return
        if (dispatch !== null && dispatch !== undefined && dispatch.stage !== stage) return
        const active = current.stages[stage]
        if (active === undefined || !isWorkStage(active) || active.state !== 'active') return
        if (review.isBusy()) return
        const latest = [...store.readMessages(roomId)].reverse()
          .find(message => message.kind === 'verdict' && message.meta?.stage === stage)
        if (latest !== undefined && verdictPassed(latest)) return
        await integrator.integrate({ stageIndex: stage, workers: [memberId], base: workspaceOf(current).head({ path: current.repoPath }), turnId })
      })
      return
    }

    const storedEvidence = store.appendMessage(roomId, evidence)
    if (assignment !== null) {
      transitionAssignment(store, assignment.id, 'reported', { turnId, evidenceIds: [storedEvidence.id] })
      writeTurnDiagnostic('evidence', {
        evidenceIds: [storedEvidence.id],
        assignmentId: assignment.id,
      })
    }
    store.appendEvent(roomId, 'turn.evidence', { stage, turnId })
    state.recordTurn(artifacts.length > 0 || (turn.toolCalls ?? 0) > 0)

    if (room !== null) {
      const target = room.stages[stage]
      const command = typeof target?.acceptance === 'string' ? target.acceptance.trim() : ''
      const key = `${stage}:${turnId}`
      if (target?.manual === true && target.state === 'active' && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        markManualReady(room, stage, turnId, worked)
        if (worked === true) autoCheck(room, stage, turnId)
      } else if (command !== '' && target?.kind === 'deliverable' && target.state === 'active' && worked && !state.acceptanceRuns.has(key)) {
        state.acceptanceRuns.add(key)
        void acceptance.run(stage, command, turnId)
      }
    }
  }

  // 服务重启后以已落盘的消息为准续跑：缺回合就重新派发，缺验收就重跑命令，待复核就重发请求，待集成就先合并。
  const resumeOnce = async ({ forceAcceptance = false } = {}) => {
    const room = store.readRoom(roomId)
    if (room === null) return
    settleCompletedSubrooms(store, roomId)
    if (room.live !== true || room.state !== 'active') return
    if ((room.busyMembers ?? []).length > 0 || workerIds(room).length === 0) return
    const stageIndex = room.stages.findIndex(stage => stage.state === 'active')
    if (stageIndex < 0) return
    const stage = room.stages[stageIndex]
    if (!isWorkStage(stage) && stage.manual !== true) return
    // 规划师已经把它交给人：重启不替人继续派活。
    if (!forceAcceptance && room.lastPlannerDecision?.stage === stageIndex && room.lastPlannerDecision?.kind === 'human') return

    const messages = store.readMessages(roomId)
    const evidence = messages.filter(message => (
      message.kind === 'evidence' &&
      (message.meta?.stage ?? 0) === stageIndex &&
      (room.demo === true || message.meta?.simulated !== true)
    ))
    const latestTurn = [...evidence].reverse().find(message => message.meta?.kind === 'turn')
    const latestCommand = [...evidence].reverse().find(message => message.meta?.kind === 'command')
    const latestManual = [...evidence].reverse().find(message => message.meta?.kind === 'manual')
    const latestTurnSeq = latestTurn?.seq ?? -1
    const dispatch = dispatchOf(store, roomId, stageIndex)

    if (!forceAcceptance && latestCommand !== undefined && (latestCommand.seq ?? 0) > latestTurnSeq) {
      if (latestCommand.meta?.exit !== 0) return
      const outcome = reviewState({ room, evidence: store.readEvidence?.(roomId), messages, stageIndex })
      if (outcome.state !== 'pending') return
      try {
        await review.request(stageIndex)
      } catch (error) {
        systemNotice({ store, roomId, text: '这一步上次没做完，已经停了；需要你处理。', error })
      }
      return
    }

    if (dispatch?.stage === stageIndex) {
      if (stage.manual === true && latestManual !== undefined && (latestManual.seq ?? 0) > latestTurnSeq) return
      if (dispatch.stalled === true) return
      if (dispatch.timedOut === true) {
        for (const item of activeDispatch(store, roomId, stageIndex)) {
          if (item.flags?.timedOut !== true) continue
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), timedOut: false } })
        }
      }
      const reported = new Set(
        evidence.filter(message => message.meta?.kind === 'turn').map(message => message.authorId),
      )
      // 只补叫醒还没交回回合的交接；已经交回的成员不再收到第二次唤醒。
      const openDispatch = activeDispatch(store, roomId, stageIndex)
        .filter(item => ['created', 'sent', 'working'].includes(item.status))
      const missing = openDispatch.filter(item => !reported.has(item.toMemberId))
      if (missing.length > 0) {
        // 重启后按“有没有产生副作用”决定续接方式：动过工具就只续接，不要再从头跑一遍。
        for (const item of missing) {
          const prompt = typeof item.brief?.prompt === 'string' ? item.brief.prompt : ''
          const acted = messages.some(message => (
            message.kind === 'activity' &&
            message.authorId === item.toMemberId &&
            (message.ts ?? 0) >= (item.sentAt ?? 0)
          ))
          if (acted) {
            try {
              await sendToMember(
                item.toMemberId,
                '继续刚才没做完的部分；如果已经完成，只汇报结果和证据，不要从头再来。',
                {
                  intent: 'handoff',
                  from: item.fromMemberId ?? leadMemberOf(room)?.id ?? '房间',
                  sendId: `resume-${item.id}`,
                },
              )
            } catch (error) {
              systemNotice({ store, roomId, text: '上次没做完的这一步没能续接；需要你处理。', error })
            }
            continue
          }
          if (prompt === '') {
            // 旧记录没有存任务原文：退回原来的派发方式。
            try {
              await stageStarter.startStage(room, stageIndex, { only: [item.toMemberId], rework: item.reason === 'rework' })
            } catch (error) {
              systemNotice({ store, roomId, text: '上次没做完的这一步没能继续；需要你处理。', error })
            }
            continue
          }
          if (item.flags?.resumed === true) {
            // 零产出重启过一次还是没有产出：停下来交给人，不再无限重发。
            transitionAssignment(store, item.id, 'failed', { resultText: '零产出重启后仍没有结果' })
            systemNotice({ store, roomId, text: '这一步重启后仍然没有产出；需要你处理。' })
            continue
          }
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), resumed: true } })
          try {
            await sendToMember(item.toMemberId, prompt, {
              intent: item.reason === 'review' ? 'review' : 'handoff',
              from: item.fromMemberId ?? leadMemberOf(room)?.id ?? '房间',
              sendId: `resume-${item.id}`,
            })
            const cleared = store.updateRoom(roomId, current => {
              if (current.blocked?.stage !== stageIndex) return null
              current.blocked = null
              return { events: [] }
            })
            if (cleared !== null) emit?.('room', cleared)
          } catch (error) {
            systemNotice({ store, roomId, text: '上次没做完的这一步没能继续；需要你处理。', error })
          }
        }
        return
      }
      const failed = [...new Set([
        ...(dispatch.failed ?? []),
        ...(dispatch.workers ?? []).filter(worker => !reported.has(worker)),
      ])]
      const workers = (dispatch.workers ?? []).filter(worker => reported.has(worker) && !failed.includes(worker))
      if (workers.length === 0) {
        for (const item of activeDispatch(store, roomId, stageIndex)) {
          updateAssignment(store, item.id, { flags: { ...(item.flags ?? {}), stalled: true } })
        }
        systemNotice({ store, roomId, text: '上次没做完的这一步仍然没有产出；需要你处理。' })
        emit?.('room', store.readRoom(roomId))
        return
      }
      await integrator.enqueue(() => integrator.integrate({
        stageIndex,
        workers,
        base: dispatch.base ?? workspaceOf(room).head({ path: room.repoPath }),
        turnId: latestTurn?.meta?.turnId ?? '',
        failed,
      }))
      return
    }

    if (stage.manual === true) {
      if (latestManual !== undefined && (latestManual.seq ?? 0) > latestTurnSeq) return
      if (latestTurn === undefined) {
        await stageStarter.startStage(room, stageIndex)
        return
      }
      if (typeof latestTurn.meta?.turnId === 'string') markManualReady(room, stageIndex, latestTurn.meta.turnId)
      return
    }

    if (latestTurn === undefined) {
      if (dispatch?.stage === stageIndex && (dispatch.stalled === true || dispatch.timedOut === true)) return
      await stageStarter.startStage(room, stageIndex)
      return
    }

    const command = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
    if (command !== '' && typeof latestTurn.meta?.turnId === 'string') {
      await acceptance.run(stageIndex, command, latestTurn.meta.turnId)
    }
  }

  const resume = async options => {
    try {
      await resumeOnce(options)
    } catch (error) {
      systemNotice({ store, roomId, text: '上次没做完的这一步没能继续；需要你处理。', error })
    }
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
    busyReview: review.isBusy,
  }
}
