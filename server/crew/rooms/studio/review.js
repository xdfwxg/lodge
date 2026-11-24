import * as log from '../../log.js'
import { randomUUID } from 'node:crypto'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { missingMentionsOf } from './relay-words.js'
import { reject } from '../../result.js'
import { REVIEW_REMINDER, REVIEW_TIMEOUT } from './turn-utils.js'
import { DECISION_JSON_HINT, LIMITS, judgmentAnchorOf, normalizeJudgment, verdictPassed } from '../../../../shared/judgment.js'
import { GATE_SERVER_NAME, gateSubmissionOf } from '../../../../shared/gate.js'
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'
import { existingTestChangesOf, protectedFilesOf } from '../../protected-files.js'
import { roomStatusOf } from '../../../../shared/room-status.js'
import { workspaceOf } from './workspace.js'
import { ensurePreviews } from './previews.js'
import { manualReviewState, reviewState, verifierIds } from './verifiers.js'
import { reviewGuidanceFor } from '../../orchestration/index.js'
import { leadMemberOf, memberOf, workerIds } from '../../room-members.js'
import { activeDispatchAssignments, latestDispatchAssignment, transitionAssignment } from '../../assignments.js'
import { memberDisplayName } from '../../member-labels.js'
import { recordShadowAdvice } from './shadow-advisor.js'
import { relayAfterVerdict } from './relay.js'
import { REVIEW_STATE, STAGE_STATE } from '../../../../shared/states.js'
import { hasLaterWorkStage, lateReviewStillValid, shadowNeeded } from './review-policy.js'
import { REVIEW_REMINDER_PROMPT, VERDICT_RETRY_PROMPT, verifierPromptOf } from './review-prompts.js'
import { systemNotice } from '../../notices.js'


export const createReviewCoordinator = ({ store, roomId, emit, sendToMember, handoff = null, shadow = null, previews = null, attachments = null, advanceStage = null }) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt }) => sendToMember(to, prompt))
  // 判定工具真的挂在这位验收员身上时，只认工具提交；注册失败才退回首行锚点。
  const gateAvailableFor = (room, memberId) => {
    const member = (room?.members ?? []).find(item => item.id === memberId)
    return Array.isArray(member?.body?.roomTools) && member.body.roomTools.includes(GATE_SERVER_NAME)
  }
  let round = null
  let shadowTask = null
  const staleMembers = new Set()

  const isBusy = () => round !== null && [...round.requests.values()].some(request => request.expired !== true)

  const consume = ({ turn, memberId, turnId, room, calls = [] }) => {
    // 新证据已经让旧复核作废时，忽略旧提示词触发的那一回合，等新回合的结论。
    if (staleMembers.has(memberId)) {
      staleMembers.delete(memberId)
      return false
    }
    const pending = round?.requests.get(memberId)
    if (pending === undefined) return false
    const late = pending.expired === true
    if (late && !lateReviewStillValid({
      room: store.readRoom(roomId),
      messages: store.readMessages(roomId),
      pending,
    })) return false
    const gate = gateSubmissionOf(calls, {
      type: 'verdict',
      stage: pending.stage,
      evidenceId: pending.evidenceId,
      actorId: pending.verifier,
    })
    // 受保护文件必须逐条确认：锁文件、包清单、CI/配置、.env 不能靠一句“通过”放行。
    const protectedFiles = Array.isArray(pending.protectedFiles) ? pending.protectedFiles : []
    const unacknowledged = gate === null
      ? protectedFiles
      : protectedFiles.filter(file => !(Array.isArray(gate.protectedFiles) ? gate.protectedFiles : []).includes(file))
    if (protectedFiles.length > 0 && (gate === null || (gate.decision === 'pass' && unacknowledged.length > 0))) {
      const name = memberDisplayName(room, memberId)
      if (pending.protectedNudged !== true) {
        pending.protectedNudged = true
        clearTimeout(pending.reminder)
        void sendToMember(memberId, [
          `这次改动包含受保护文件：${protectedFiles.map(file => sanitizeUntrusted(file, 200)).join('、')}。`,
          'PASS 必须在 submit_verdict 的 protectedFiles 里逐条列出并确认这些文件；不认可就判不通过，或交给人。',
          INTERNAL_PROMPT_MARKER,
        ].join('\n'), { intent: 'review' }).catch(() => {})
        return true
      }
      pending.expire?.(`${name} 的判定没有逐条确认受保护文件，这一轮仍未通过。`)
      return true
    }
    // 工具挂上了却没用：先催一次，再按“没有判定”收口，不拿文本猜结论。
    // 工具有注册失败（没挂上）时，才允许首行锚点作为降级；两样都没有同样不猜。
    const gateAvailable = gateAvailableFor(room, pending.verifier)
    if (gate === null && (gateAvailable || judgmentAnchorOf('verdict', turn.reply) === null)) {
      const name = memberDisplayName(room, memberId)
      if (pending.nudged !== true) {
        pending.nudged = true
        clearTimeout(pending.reminder)
        void sendToMember(memberId, VERDICT_RETRY_PROMPT, { intent: 'review' }).catch(() => {})
        return true
      }
      pending.expire?.(`${name} 没有提交验收判定，这一轮仍未通过。`)
      return true
    }
    round.requests.delete(memberId)
    clearTimeout(pending.timer)
    clearTimeout(pending.reminder)
    const judgment = gate ?? normalizeJudgment({
      type: 'verdict',
      text: turn.reply,
      stage: pending.stage,
      evidenceId: pending.evidenceId,
      actorId: pending.verifier,
    })
    // 平台给过渲染图，就必须引用像素检查；看不到可以写 seen:false，但不能装作没这回事。
    const current = store.readRoom(roomId)
    const expected = (current?.previews ?? [])
      .find(item => item.stage === pending.stage && item.evidenceId === pending.evidenceId && item.audit)?.audit ?? null
    const visual = judgment.visual ?? null
    // 只要引用了平台检查的形状就算核对过；两次渲染的颜色数可能差一两个，不因此判成没看。
    const visualOk = expected === null ||
      (visual !== null &&
        typeof visual.seen === 'boolean' &&
        Number.isInteger(visual.colors) &&
        Number.isInteger(visual.contrast))
    // 不在这里追问：复核回合已经结束，重问会让复核挂住；缺了就如实标记，交给交付卡和系统消息说明。
    const visualMissing = !visualOk
    const pass = judgment.decision === 'pass'
    const independent = room?.independence === 'vendor'
    const name = memberDisplayName(room, memberId)
    const spec = memberOf(room, pending.verifier)
    const verdictMessage = store.appendMessage(roomId, {
      kind: 'verdict',
      authorId: pending.verifier,
      text: gate === null ? (turn.reply || '复核回合没有给出文字结论。') : (judgment.reason || '验收员通过工具提交了判定。'),
      meta: {
        pass,
        judgment,
        reason: gate === null ? (turn.reply ?? '') : judgment.reason,
        roleKind: 'verifier',
        verifierProfile: spec?.roleProfile ?? name,
        mode: 'bot',
        stage: pending.stage,
        command: pending.command,
        exit: pending.exit,
        evidenceId: pending.evidenceId,
        review: true,
        independent,
        verifier: pending.verifier,
        turnId,
        simulated: false,
        ...(visualMissing ? { visualMissing: true } : {}),
        ...(late ? { late: true } : {}),
      },
    })
    if (late) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${name} 的判定晚到了；这一步和证据没变，按这条处理。`,
      })
    }
    if (visualMissing) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${name} 这次只看文字，效果图没有核对。`,
        meta: { kind: 'visual', stage: pending.stage },
      })
    }
    store.appendEvent(roomId, 'verifier.verdict', { stage: pending.stage, verifier: pending.verifier, pass, independent, turnId, late })
    const reviewAssignment = store.readAssignments(roomId, { stage: pending.stage, limit: 500 })
      .filter(item => item.reason === 'review' && item.toMemberId === pending.verifier)
      .at(-1)
    if (reviewAssignment !== undefined) {
      transitionAssignment(store, reviewAssignment.id, pass ? 'passed' : 'rejected', {
        turnId,
        verdictIds: [...(reviewAssignment.verdictIds ?? []), verdictMessage.id],
      })
    }
    if (pass) round.passed = (round.passed ?? 0) + 1
    else round.rejects = (round.rejects ?? 0) + 1

    const passed = round.passed ?? 0
    const rejected = round.rejects ?? 0
    const required = round.required ?? round.total
    const reachedQuorum = passed >= required
    const impossible = rejected > round.total - required
    const waiting = [...round.requests.values()].filter(request => request.expired !== true)
    const settled = reachedQuorum || impossible || waiting.length === 0

    if (!settled) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${name} ${pass ? '通过' : '退回'}；还有 ${waiting.length} 位验收员在看。`,
      })
      return true
    }

    for (const [remainingMember, request] of round.requests) {
      clearTimeout(request.timer)
      clearTimeout(request.reminder)
      store.appendEvent(roomId, 'review.cancelled', {
        stage: pending.stage,
        verifier: remainingMember,
        reason: reachedQuorum ? '验收意见已经够了' : '验收意见不可能凑齐了',
      })
    }
    round.requests.clear()
    const total = round.total
    round = null
    if (reachedQuorum) {
      store.appendEvent(roomId, 'review.passed', { stage: pending.stage, verifier: pending.verifier, passed, total })
      const current = store.readRoom(roomId) ?? room
      const later = hasLaterWorkStage(current, pending.stage)
      // 自动交付只认工具提交的结构化判定；文本兜底没有保证 outsideDiff，仍交给人收。
      const roundDelivers = current.autoDeliver === true || current.workRound?.autoDeliver === true
      const autoDeliver = !later && roundDelivers && gate !== null && typeof advanceStage === 'function'
      if ((later || autoDeliver) && typeof advanceStage === 'function') {
        // 中间步骤自动过；房间开了自动交付时，最后一步也不等人点确认。
        void Promise.resolve(advanceStage(roomId, pending.stage, { by: 'system', auto: autoDeliver })).then(result => {
          if (result?.ok === false) {
            store.appendMessage(roomId, {
              kind: 'system',
              text: autoDeliver
                ? `这一步验收通过了，但没能自动交付：${result.error ?? '待处理'}。`
                : `这一步验收通过了，但没能自动进入下一步：${result.error ?? '待处理'}。`,
            })
          }
        }).catch(error => {
          systemNotice({
            store,
            roomId,
            text: autoDeliver ? '这一步验收通过了，但没能自动交付；待处理。' : '这一步验收通过了，但没能自动进入下一步；待处理。',
            error,
          })
        })
        return true
      }
      store.appendMessage(roomId, {
        kind: 'system',
        authorId: pending.verifier,
        text: '全部验收员通过；@规划师 收尾。',
        // 收尾回执只进账本；结果卡就是这一轮的收尾，不再用一条系统气泡说一遍。
        meta: { kind: 'handoff', stage: pending.stage, from: pending.verifier, to: 'planner', authorKind: 'system', show: false },
      })
      const lead = leadMemberOf(room)?.id
      if (typeof lead === 'string' && lead !== '') {
        const stage = room.stages?.[pending.stage]
        const stageTitle = stage?.title ?? ''
        // 收尾也是一次成员之间的交接：验收员把结果交给规划师。
        void handoffTrigger({
          room,
          stage,
          index: pending.stage,
          from: pending.verifier,
          to: lead,
          reason: 'summary',
          prompt: [
            `第 ${pending.stage + 1} 步「${stageTitle}」验收通过。`,
            '请在群里用两三句话总结这一步的结果和下一步；不要改文件，也不要再派活。',
            INTERNAL_PROMPT_MARKER,
          ].join('\n'),
          visible: false,
          deliver: true,
          acceptance: stage?.acceptance ?? '',
          parentAssignmentId: reviewAssignment?.id ?? null,
          nonce: String(pending.evidenceId ?? pending.verifier),
        }).catch(error => {
          systemNotice({ store, roomId, text: '没能叫规划师收尾；这一步仍等你确认。', error })
        })
      }
    } else {
      const stage = room.stages?.[pending.stage]
      const stageTitle = stage?.title ?? ''
      const reason = String(gate === null ? (turn.reply ?? '') : judgment.reason).trim().slice(0, 300)
      const targets = (Array.isArray(stage?.assignees) ? stage.assignees : [])
        .filter(id => workerIds(room).includes(id))
      const workers = targets.length > 0 ? targets : workerIds(room)
      const reworksUsed = store.readMessages(roomId).filter(message => (
        message.kind === 'rework' && (message.meta?.stage ?? 0) === pending.stage
      )).length
      const relay = relayAfterVerdict({
        pass: false,
        reworksUsed,
        mergeConflict: room.mergeConflict?.stage === pending.stage,
        targets: workers,
      })
      if (relay.kind === 'rework') {
        // 验收员直接交回执行官；规划师不转达退回，只在最后收尾。
        store.appendEvent(roomId, 'review.rework_routed', {
          stage: pending.stage,
          verifier: pending.verifier,
          targets: relay.targets,
          reworksUsed,
        })
        const parallel = relay.targets.length > 1
        const note = reason === '' ? '按验收意见重做这一步。' : reason
        const targetNames = relay.targets.map(target => memberDisplayName(room, target))
        if (parallel) {
          // 并行重做的 @ 也只发一条，分发本身私下进各自副本。
          store.appendMessage(roomId, {
            kind: 'system',
            authorId: pending.verifier,
            text: `@${targetNames.join('、@')} 验收退回，按上面的意见重做第 ${pending.stage + 1} 步。`,
            meta: { kind: 'handoff', stage: pending.stage, from: pending.verifier, to: relay.targets, authorKind: 'system' },
          })
        }
        // 返工账本要留下这一笔：预算计数和后续复核的 floor 都只认 rework。
        store.appendMessage(roomId, {
          kind: 'rework',
          authorId: 'system',
          text: '验收退回，执行官重做。',
          meta: {
            stage: pending.stage,
            source: 'verifier',
            note,
            verdictId: verdictMessage.id,
          },
        })
        for (const target of relay.targets) {
          const parent = latestDispatchAssignment(store, roomId, pending.stage, target)
          if (parent !== null) {
            transitionAssignment(store, parent.id, 'failed', { resultText: '验收退回，执行官重做' })
          }
          void handoffTrigger({
            room,
            stage,
            index: pending.stage,
            from: pending.verifier,
            to: target,
            reason: 'rework',
            prompt: `${note}\n${INTERNAL_PROMPT_MARKER}`,
            // @ 由系统写；退回理由已经在验收卡里，不再重复一整条。
            message: parallel ? '' : `@${memberDisplayName(room, target)} 验收退回，按上面的意见重做。`,
            visible: !parallel,
            deliver: true,
            ...(parallel ? { privateRoom: true } : {}),
            acceptance: stage?.acceptance ?? '',
            rework: true,
            parentAssignmentId: parent?.id ?? null,
          }).catch(error => {
            systemNotice({ store, roomId, text: `重做没能交给${memberDisplayName(room, target)}；待处理。`, error })
          })
        }
      } else {
        store.appendMessage(roomId, {
          kind: 'system',
          authorId: pending.verifier,
          text: `验收退回了第 ${pending.stage + 1} 步；@规划师 接手决定重做还是交给人。`,
          meta: { kind: 'handoff', stage: pending.stage, from: pending.verifier, to: 'planner', authorKind: 'system' },
        })
        const lead = leadMemberOf(room)?.id
        if (typeof lead === 'string' && lead !== '') {
          // 只有重做预算用完、合并冲突或没有可执行官时才回到规划师/人。
          void handoffTrigger({
            room,
            stage,
            index: pending.stage,
            from: pending.verifier,
            to: lead,
            reason: 'decision',
            prompt: [
              `验收员退回了第 ${pending.stage + 1} 步「${stageTitle}」。`,
              `判定：${reason === '' ? '未通过' : sanitizeUntrusted(reason, 300)}`,
              '判定必须先用工具提交，不要在回复里只写结论：',
              '1. 调用 lodge_gate_submit_decision（基座可能显示为 mcp__lodge_gate__submit_decision）。',
              '2. 如果工具列表里没有它，先调用 ToolSearch，查询 "lodge_gate_submit_decision"，再调用它。',
              '3. 只有工具确实不可用时，才按下面的文本格式回复；此时第一行只写「返工」或「交给人」。',
              '返工时写清改什么、怎么算完成；交给人时写清要人拍板什么。',
              '交给人时，在 actionRequired 里用 A. / B. 列出 2–3 个具体选择，每项一句话；用户会直接点。',
              DECISION_JSON_HINT,
              '决定返工时不要 @ 任何人；系统会把要求直接送进该重做的执行官手里。第一行仍只写「返工」。',
              '不要自己改文件，也不要自己验收。',
              INTERNAL_PROMPT_MARKER,
            ].join('\n'),
            visible: false,
            deliver: true,
            acceptance: stage?.acceptance ?? '',
            parentAssignmentId: reviewAssignment?.id ?? null,
            nonce: String(pending.evidenceId ?? pending.verifier),
          }).catch(error => {
            systemNotice({ store, roomId, text: '没能叫醒规划师；稍后会自动再试。', error })
          })
        }
      }
    }

    return true
  }

  const request = async stageIndex => {
    const room = store.readRoom(roomId)
    const stage = room?.stages?.[stageIndex]
    if (stage === undefined || (stage.kind !== 'deliverable' && stage.manual !== true)) {
      reject('invalid', '这个阶段不是交付型')
    }
    if (stage.state !== STAGE_STATE.active) reject('conflict', '这个阶段不在待验收状态')
    if (roomStatusOf(room) !== 'active') {
      reject('conflict', '这一轮已经结束，不能再发起复核')
    }
    const messages = store.readMessages(roomId)
    // 默认盲评：验收员只看目标、验收、diff 和证据，不看执行官怎么讲；决策类阶段才放开过程话。
    const blind = room.orchestration === 'critique' || stage?.kind !== 'decision'
    const manual = stage.manual === true
    const ledger = store.readEvidence?.(roomId)
    const outcome = manual
      ? manualReviewState({ room, evidence: ledger, messages, stageIndex })
      : reviewState({ room, evidence: ledger, messages, stageIndex })
    if (outcome.state === 'pass') reject('conflict', '本阶段验收员已经全部通过')
    if (outcome.state === 'reject') reject('conflict', '验收退回了；先重做再检查一次')
    if (outcome.state === 'failed') reject('conflict', '最新检查没有通过；先重做再检查一次')
    const ids = verifierIds(room)
    if (ids.length === 0) reject('conflict', '房间没有验收员')
    const evidence = outcome.evidence
    if (evidence === undefined || evidence === null) {
      reject('conflict', manual ? '还没有本阶段的结果证据' : '还没有本阶段的验收命令证据')
    }
    if (round !== null && round.finished === true) {
      for (const [memberId, pending] of round.requests) {
        clearTimeout(pending.timer)
        clearTimeout(pending.reminder)
        staleMembers.add(memberId)
      }
      round = null
    }
    if (round !== null) {
      if (round.evidenceId === evidence.id) reject('conflict', '上一次复核还没有结束')
      for (const [memberId, pending] of round.requests) {
        clearTimeout(pending.timer)
        clearTimeout(pending.reminder)
        staleMembers.add(memberId)
      }
      store.appendEvent(roomId, 'review.restarted', {
        stage: stageIndex,
        from: round.evidenceId,
        to: evidence.id,
      })
      round = null
    }
    const targets = outcome.state === REVIEW_STATE.pending ? outcome.missing : ids
    if (targets.length === 0) reject('conflict', '所有验收员都已回报')

    const meta = evidence.meta
    // 平台先把交付渲染成图；验收员先看图，再回代码核对。
    const shots = await ensurePreviews({
      room,
      stageIndex,
      evidence,
      capture: previews?.capture,
      attachments,
      updateRound: store.updateRound,
    })
    const reviewGuidance = reviewGuidanceFor(room)
    const nextRound = {
      stage: stageIndex,
      evidenceId: evidence.id,
      command: manual ? '' : meta.command,
      exit: manual ? null : meta.exit,
      total: ids.length,
      required: ids.length,
      passed: outcome.verdicts.filter(verdictPassed).length,
      rejects: outcome.verdicts.filter(message => !verdictPassed(message)).length,
      requests: new Map(),
    }
    round = nextRound
    store.updateRound(roomId, current => {
      current.reviewRetriedAt = Date.now()
      // 本轮复核的验收员在发起时固定；之后加成员只影响下一轮，不回头改这一轮的结论。
      if (Array.isArray(current.stages) && current.stages[stageIndex] !== undefined) {
        current.stages[stageIndex].reviewers = [...targets]
      }
      return { events: [] }
    })
    store.appendEvent(roomId, 'review.requested', {
      stage: stageIndex,
      evidenceId: evidence.id,
      verifiers: targets,
    })
    // 执行官自己最后一句已经 @ 了验收员就不再补一条；同一棒不 @ 两次。
    const senderId = (Array.isArray(stage?.assignees) ? stage.assignees : [])
      .find(id => workerIds(room).includes(id)) ?? workerIds(room)[0] ?? 'lodge'
    const missing = missingMentionsOf({ room, messages, from: senderId, targets })
    if (missing.length > 0) {
      store.appendMessage(roomId, {
        kind: 'system',
        authorId: senderId,
        text: `@${missing.map(verifier => memberDisplayName(room, verifier)).join('、@')} 第 ${stageIndex + 1} 步「${sanitizeUntrusted(stage.title, 120)}」结果好了，请复核。`,
        meta: { kind: 'handoff', stage: stageIndex, from: senderId, to: missing, reason: 'review', authorKind: 'system' },
      })
    }
    // 影子评审和验收派发并行：建议只记录，不进入验收员提示词，也不拖住验收。
    shadowTask = shadowNeeded({ room, stage, evidence, manual, messages, stageIndex })
      ? recordShadowAdvice({
        store,
        roomId,
        shadow,
        room,
        emit,
        index: stageIndex,
        stage,
        evidence,
        manual,
      }).catch(error => {
        systemNotice({ store, roomId, text: '影子评审这次没取到；验收不受影响。', error })
        return null
      })
      : null
    const failures = []
    for (const verifier of targets) {
      const verifierName = memberDisplayName(room, verifier)
      if (typeof verifierName !== 'string' || verifierName === '') {
        failures.push(`${verifier}: 没有成员名字`)
        continue
      }
      const reviewBranch = typeof room.branch === 'string' && room.branch !== '' ? room.branch : room.primaryBranch
      if (room.worktrees?.[verifier] !== undefined && typeof reviewBranch === 'string' && reviewBranch !== '') {
        try {
          // 复核副本必须和刚才验收的那份一致：优先用证据里的候选提交，分支可能还没跟上。
          const reviewRef = typeof meta.candidate === 'string' && meta.candidate !== ''
            ? meta.candidate
            : reviewBranch
          workspaceOf(room).refreshReviewCopy({ path: room.worktrees[verifier], branch: reviewRef, source: room.sourceRepo, from: room.repoPath })
        } catch (error) {
          failures.push(`${verifierName}: 复核副本不可用（${error?.message ?? error}）`)
          systemNotice({ store, roomId, text: `${verifierName} 的复核没法开始；待处理。`, error })
          continue
        }
      }
      const verifierPort = room.ports?.[verifier]
      // 既有测试的改动也在这里：改断言/删检查，等于改判分标准。
      const protectedFiles = [...new Set([
        ...protectedFilesOf(meta.changedFiles),
        ...existingTestChangesOf({ files: meta.changedFiles, diff: meta.diff }),
      ])].slice(0, LIMITS.protectedFiles)
      const prompt = verifierPromptOf({
        room,
        stage,
        stageIndex,
        verifier,
        targets,
        ids,
        manual,
        blind,
        evidence,
        meta,
        shots,
        verifierPort,
        protectedFiles,
        reviewGuidance,
        messages,
      })

      const request = {
        stage: stageIndex,
        verifier,
        command: manual ? '' : meta.command,
        exit: manual ? null : meta.exit,
        evidenceId: evidence.id,
        protectedFiles,
        requestedAt: Date.now(),
        timer: null,
        reminder: null,
      }
      nextRound.requests.set(verifier, request)
      const expire = text => {
        if (round !== nextRound || round.requests.get(verifier) !== request) return
        request.expired = true
        clearTimeout(request.reminder)
        clearTimeout(request.timer)
        store.appendEvent(roomId, 'review.timeout', { stage: stageIndex, verifier })
        store.appendMessage(roomId, { kind: 'system', text })
        round.timedOut = [...(round.timedOut ?? []), verifier]
        const waiting = [...round.requests.values()].filter(item => item.expired !== true)
        if (waiting.length === 0) {
          round.finished = true
          store.appendMessage(roomId, {
            kind: 'system',
            text: `这次复核到时间了：${round.passed}/${round.total} 位验收员通过；其余未回报，不能确认。可以重新发起复核。`,
            meta: { kind: 'review_timeout', stage: stageIndex, verifiers: round.timedOut },
          })
        }
      }
      request.expire = expire
      request.reminder = setTimeout(() => {
        if (round !== nextRound || round.requests.get(verifier) !== request) return
        void sendToMember(verifier, REVIEW_REMINDER_PROMPT, { intent: 'review' }).catch(() => {})
      }, REVIEW_REMINDER).unref()
      request.timer = setTimeout(
        () => expire(`${verifierName} 复核超时，没有收到验收结论；这一轮仍未通过。`),
        REVIEW_TIMEOUT,
      ).unref()
      const source = [...messages].reverse().find(message => (
        message.kind === 'evidence' &&
        message.meta?.kind === 'turn' &&
        (message.meta?.stage ?? 0) === stageIndex
      ))?.authorId
      const parent = activeDispatchAssignments(store, roomId, stageIndex)
        .filter(item => item.toMemberId === (source ?? evidence.authorId))
        .at(-1)
        ?? activeDispatchAssignments(store, roomId, stageIndex).at(-1)
        ?? null
      try {
        await handoffTrigger({
          room,
          stage,
          index: stageIndex,
          from: source ?? evidence.authorId ?? leadMemberOf(room)?.id ?? 'you',
          to: verifier,
          reason: 'review',
          prompt,
          visible: false,
          acceptance: stage.acceptance ?? '',
          evidence,
          verdict: outcome.verdicts?.at(-1) ?? null,
          parentAssignmentId: parent?.id ?? null,
          // 重启后重新发起复核时，提示词可能已经变了；固定 sendId 会被基座当成另一条消息拒绝。
          nonce: randomUUID(),
        })
      } catch (error) {
        clearTimeout(request.timer)
        clearTimeout(request.reminder)
        nextRound.requests.delete(verifier)
        failures.push(`${verifierName}: ${error?.message ?? error}`)
        store.appendMessage(roomId, {
          kind: 'system',
          text: `没能把复核请求发给${verifierName}；待处理。`,
        })
      }
    }
    if (nextRound.requests.size === 0) {
      round = null
      if (failures.length > 0) log.warn(`[lodge] 复核请求没有发出：${failures.join('；')}`)
      reject('conflict', '复核请求没能发出去；待处理。')
    }
    return { requested: true, stage: stageIndex, verifiers: [...nextRound.requests.keys()] }
  }

  return { request, consume, isBusy, shadowSettled: () => shadowTask ?? Promise.resolve() }
}
