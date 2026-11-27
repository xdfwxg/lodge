import * as log from '../../../../log.js'
import { randomUUID } from 'node:crypto'
import { appendHandoffProjection } from '../../runtime/projection.js'
import { reject } from '../../../../result.js'
import { REVIEW_REMINDER, REVIEW_TIMEOUT } from '../../runtime/turn-utils.js'
import { LIMITS, verdictPassed } from '../../../../../../shared/judgment.js'
import { beginWriteGuard } from '../../../../workspace-guard.js'
import { applyProbePatch } from '../../delivery/probe-patch.js'
import { runProof } from '../../delivery/proof-runner.js'
import { deliversProofOf, deliveryFactsOf, requiresProofOf } from '../acceptance.js'
import { sanitizeUntrusted } from '../../../../../../shared/untrusted-text.js'
import { existingTestChangesOf, protectedFilesOf } from '../../../../protected-files.js'
import { roomStatusOf } from '../../../../../../shared/room-status.js'
import { workspaceOf } from '../../runtime/workspace.js'
import { ensurePreviews } from '../../delivery/previews.js'
import { reviewState, verifierIds } from '../verifiers.js'
import { reviewGuidanceFor } from '../../../../orchestration/index.js'
import { leadMemberOf, workerIds } from '../../../../room-members.js'
import { activeDispatchAssignments } from '../../../../assignments.js'
import { memberDisplayName } from '../../../../member-labels.js'
import { REVIEW_STATE } from '../../../../../../shared/states.js'
import { COMMAND_BY, commandRefusal } from '../../../../../../shared/studio-commands.js'
import { REVIEW_REMINDER_PROMPT, verifierPromptOf } from '../review-prompts.js'
import { systemNotice } from '../../../../notices.js'

// 发起一轮复核：算清谁该看、把结果渲染成图、给每位验收员刷新复核副本并送出请求。
// 这里只负责“把请求送到”；收到之后怎么算、算完去哪，是 verdict.js 和 settle.js 的事。
export const startReview = async ({ store, roomId, session, stageIndex, handoffTrigger, previews = null, attachments = null }) => {
  const room = store.readRoom(roomId)
  // 谁能发起、阶段和房间在什么状态，只有命令目录说了算。
  const refusal = commandRefusal({ command: 'verify', room: { ...room, state: roomStatusOf(room) }, by: COMMAND_BY.YOU, stageIndex })
  if (refusal !== null) reject(refusal.code, refusal.text)
  const stage = room?.stages?.[stageIndex]
  const messages = store.readMessages(roomId)
  // 默认盲评：验收员只看目标、验收、diff 和证据，不看执行官怎么讲；决策类阶段才放开过程话。
  const blind = room.orchestration === 'critique' || stage?.kind !== 'decision'
  const ledger = store.readEvidence?.(roomId)
  const outcome = reviewState({ room, evidence: ledger, messages, stageIndex })
  if (outcome.state === 'pass') reject('conflict', '本阶段验收员已经全部通过')
  if (outcome.state === 'reject') reject('conflict', '验收退了；先重做再检查一次')
  const ids = verifierIds(room)
  if (ids.length === 0) reject('conflict', '房间没有验收员')
  const evidence = outcome.evidence
  if (evidence === undefined || evidence === null) {
    reject('conflict', '还没有本阶段的结果证据')
  }
  // 上一轮已经收完（到最后一位也没凑够）：直接放下，不用重开。
  if (session.current() !== null && session.current().finished === true) session.dropRound()
  if (session.current() !== null) {
    const previous = session.current()
    if (previous.evidenceId === evidence.id) reject('conflict', '上一次复核还没有结束')
    session.dropRound()
    store.appendEvent(roomId, 'review.restarted', {
      stage: stageIndex,
      from: previous.evidenceId,
      to: evidence.id,
    })
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
    total: ids.length,
    required: ids.length,
    passed: outcome.verdicts.filter(verdictPassed).length,
    rejects: outcome.verdicts.filter(message => !verdictPassed(message)).length,
    requests: new Map(),
  }
  session.begin(nextRound)
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
  // 复核请求的 @ 由真正产出这份结果的人发出；没有产出人时退回这一步的执行者。
  const evidenceAuthor = typeof evidence.authorId === 'string' && workerIds(room).includes(evidence.authorId)
    ? evidence.authorId
    : ''
  const senderId = evidenceAuthor ||
    (Array.isArray(stage?.assignees) ? stage.assignees : []).find(id => workerIds(room).includes(id)) ||
    workerIds(room)[0] || 'lodge'
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
    // 探针在副本刷新之后、复核之前注入缺陷；正常运行时环境变量不存在，这一层是空操作。
    // 补丁要提交成复核副本的 HEAD：验收员从 git 取“干净副本”时看到的也必须是这份缺陷。
    try {
      const patched = applyProbePatch({
        dir: process.env.LODGE_PROBE_REVIEW_PATCH_DIR,
        roomId,
        root: room.worktrees?.[verifier],
        stageIndex,
      })
      if (patched.length > 0) {
        let commit = null
        try {
          commit = workspaceOf(room).submit({
            path: room.worktrees[verifier],
            turnId: `probe-${stageIndex}`,
            name: 'review patch',
          })
        } catch {}
        store.appendEvent(roomId, 'probe.review_patch', { stage: stageIndex, verifier, files: patched, commit })
      }
    } catch {}
    const verifierPort = room.ports?.[verifier]
    // 既有测试的改动也在这里：改断言/删检查，等于改判分标准。
    const protectedAll = [...new Set([
      ...protectedFilesOf(meta.changedFiles),
      ...existingTestChangesOf({ files: meta.changedFiles, diff: meta.diff }),
    ])]
    if (protectedAll.length > LIMITS.protectedFiles) {
      failures.push(`${verifierName}: 受保护文件超过 ${LIMITS.protectedFiles} 个，无法逐条确认`)
      systemNotice({ store, roomId, text: `${verifierName} 的复核没法开始：受保护文件太多。` })
      continue
    }
    const protectedFiles = protectedAll
    const prompt = verifierPromptOf({
      room,
      stage,
      stageIndex,
      verifier,
      targets,
      ids,
      blind,
      evidence,
      meta,
      shots,
      verifierPort,
      protectedFiles,
      reviewGuidance,
      messages,
    })

    const facts = deliveryFactsOf({ evidence })
    const requireProof = requiresProofOf({ room, stage, stageIndex })
    // 这一步自己交证明文件时，“证明偏弱”不成立（文件本来就是这一步才有的）。
    const proofIsDeliverable = deliversProofOf(stage)
    // 证明由平台在**验收员自己的复核副本**里重跑一次：重跑是副作用，不该交给模型复述命令。
    // 跑出来的事实替换交付方自述的那份，后面的判定只看这一次。
    const reviewProof = requireProof
      ? await runProof({
        room: { ...room, repoPath: room.worktrees?.[verifier] ?? room.repoPath },
        ref: null,
        behavior: 'preserve',
        provider: workspaceOf(room),
      }).catch(error => ({ status: 'unsupported', error: String(error?.message ?? error) }))
      : null
    const proofFacts = reviewProof === null
      ? facts.proof
      : {
        status: reviewProof.status,
        weak: false,
        error: reviewProof.error ?? '',
        entries: [],
        failedOutput: reviewProof.error ?? '',
      }
    const request = {
      stage: stageIndex,
      verifier,
      evidenceId: evidence.id,
      // 交付本身的事实只有一份：acceptance.js 的 deliveryFactsOf；
      // 证明那一项在有要求时换成平台在复核副本里实跑出来的结果。
      facts: { ...facts, proof: proofFacts },
      requireProof,
      proofIsDeliverable,
      changedFiles: facts.changedFiles,
      proofStatus: proofFacts.status,
      proofError: proofFacts.error,
      proofFailure: proofFacts.failedOutput,
      protectedFiles,
      privateRoom: blind,
      requestedAt: Date.now(),
      timer: null,
      reminder: null,
    }
    nextRound.requests.set(verifier, request)
    request.reminder = setTimeout(() => {
      if (!session.isCurrent(nextRound) || session.requestOf(verifier) !== request) return
      void session.deliver(request, REVIEW_REMINDER_PROMPT).catch(() => {})
    }, REVIEW_REMINDER).unref()
    // 超时量的是沉默，不是干活：验收员还在跑命令（房间里能看到它自己的动静），
    // 就按最后一次动静重新起算；真停住了才结束这一拍。回合本身另有基座的预算上限。
    const lastSignOfLife = () => {
      const latest = [...store.readMessages(roomId)].reverse().find(message => (
        message.authorId === verifier &&
        (message.meta?.authorKind !== 'system') &&
        typeof message.ts === 'number' &&
        message.ts >= request.requestedAt
      ))
      return latest?.ts ?? 0
    }
    const armTimer = () => {
      request.timer = setTimeout(() => {
        if (!session.isCurrent(nextRound) || session.requestOf(verifier) !== request) return
        const latest = lastSignOfLife()
        if (latest > 0 && Date.now() - latest < REVIEW_TIMEOUT) {
          armTimer()
          return
        }
        session.expire(request, `${verifierName} 复核超时，没有收到验收结论；这一轮仍未通过。`)
      }, REVIEW_TIMEOUT)
      request.timer.unref?.()
    }
    armTimer()
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
      request.assignment = await handoffTrigger({
        room,
        stage,
        index: stageIndex,
        from: source ?? evidence.authorId ?? leadMemberOf(room)?.id ?? 'you',
        to: verifier,
        reason: 'review',
        prompt,
        privateRoom: blind,
        evidence,
        verdict: outcome.verdicts?.at(-1) ?? null,
        parentAssignmentId: parent?.id ?? null,
        // 重启后重新发起复核时，提示词可能已经变了；固定 sendId 会被基座当成另一条消息拒绝。
        nonce: randomUUID(),
      })
    } catch (error) {
      session.clearTimers(request)
      nextRound.requests.delete(verifier)
      failures.push(`${verifierName}: ${error?.message ?? error}`)
      store.appendMessage(roomId, {
        kind: 'system',
        text: `没能把复核请求发给${verifierName}；待处理。`,
      })
    }
  }
  // 平台刚换了验收员副本（候选提交、探针补丁）：从这一份重新记底，
  // 否则下一位说话人收回合时会把平台的 checkout 当成验收员越界，误拦停整轮。
  if (nextRound.requests.size > 0) beginWriteGuard(store.readRoom(roomId) ?? room)
  // 只 @ 真正收到复核请求的验收员：先送，再投影。
  const requested = [...nextRound.requests.keys()]
  if (requested.length > 0) {
    appendHandoffProjection({
      store,
      roomId,
      room,
      from: senderId,
      targets: requested,
      message: to => `@${to.map(verifier => memberDisplayName(room, verifier)).join('、@')} 第 ${stageIndex + 1} 步「${sanitizeUntrusted(stage.title, 120)}」结果好了，请复核。`,
      meta: {
        stage: stageIndex,
        reason: 'review',
        dedupeKey: `review:${stageIndex}:${evidence.id}:${requested.join(',')}`,
      },
    })
  }
  if (nextRound.requests.size === 0) {
    session.end()
    if (failures.length > 0) log.warn(`[lodge] 复核请求没有发出：${failures.join('；')}`)
    reject('conflict', '复核请求没能发出去；待处理。')
  }
  return { requested: true, stage: stageIndex, verifiers: [...nextRound.requests.keys()] }
}
