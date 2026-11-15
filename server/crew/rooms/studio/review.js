import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { reject } from '../../result.js'
import { parseVerdict, REVIEW_REMINDER, REVIEW_TIMEOUT, tail } from './turn-utils.js'
import { studioTransitionEvent, transitionStudio } from './state.js'
import { workspaceOf } from './workspace.js'
import { manualReviewState, reviewState, verifierIds } from './verifiers.js'
import { markStageTasks } from './tasks.js'
import { reviewGuidanceFor } from '../../orchestration/index.js'
import { seatDisplayName, seatMention } from '../../seat-labels.js'

const VERDICT_FORMAT = '第一行写 PASS 或 REJECT，紧接着一句结论（不超过 50 字，说清产物是否达标）；从第二行起每行一条关键证据，最多 3 条；总字数控制在 200 字内。命令和退出码卡片已经显示，不要再复述。'


export const createReviewCoordinator = ({ store, roomId, emit, sendToSeat, updateTasks, handoff = null, advisor = null }) => {
  const handoffTrigger = handoff?.trigger ?? (async ({ to, prompt }) => sendToSeat(to, prompt))
  let round = null
  const staleSeats = new Set()

  const isBusy = () => round !== null && round.requests.size > 0

  const consume = ({ turn, seat, turnId, room }) => {
    // 新证据已经让旧复核作废时，忽略旧提示词触发的那一回合，等新回合的结论。
    if (staleSeats.has(seat)) {
      staleSeats.delete(seat)
      return false
    }
    const pending = round?.requests.get(seat)
    if (pending === undefined) return false
    round.requests.delete(seat)
    clearTimeout(pending.timer)
    clearTimeout(pending.reminder)
    const pass = parseVerdict(turn.reply)
    const name = seatDisplayName(room, seat)
    const spec = room.seatSpecs?.find(item => item.id === pending.verifier)
    store.appendMessage(roomId, {
      kind: 'verdict',
      authorId: pending.verifier,
      text: turn.reply || '复核回合没有给出文字结论。',
      meta: {
        pass,
        reason: turn.reply ?? '',
        roleKind: 'verifier',
        verifierProfile: spec?.roleProfile ?? name,
        mode: 'bot',
        stage: pending.stage,
        command: pending.command,
        exit: pending.exit,
        evidenceId: pending.evidenceId,
        review: true,
        independent: true,
        verifier: pending.verifier,
        turnId,
        simulated: false,
      },
    })
    store.appendEvent(roomId, 'verifier.verdict', { stage: pending.stage, verifier: pending.verifier, pass, independent: true, turnId })
    if (pass) round.passed = (round.passed ?? 0) + 1
    else round.rejects = (round.rejects ?? 0) + 1

    const passed = round.passed ?? 0
    const rejected = round.rejects ?? 0
    const required = round.required ?? round.total
    const reachedQuorum = passed >= required
    const impossible = rejected > round.total - required
    const settled = reachedQuorum || impossible || round.requests.size === 0

    if (!settled) {
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${name} ${pass ? 'PASS' : 'REJECT'}；还有 ${round.requests.size} 个验收席位复核中。`,
      })
      return true
    }

    for (const [remainingSeat, request] of round.requests) {
      clearTimeout(request.timer)
      clearTimeout(request.reminder)
      store.appendEvent(roomId, 'review.cancelled', {
        stage: pending.stage,
        verifier: remainingSeat,
        reason: reachedQuorum ? '已达到验收 quorum' : '验收已不可能达到 quorum',
      })
    }
    round.requests.clear()
    const total = round.total
    const policy = round.policy
    round = null
    if (reachedQuorum) {
      updateTasks(pending.stage, current => markStageTasks(current, 'done'))
      store.appendMessage(roomId, {
        kind: 'system',
        text: policy === 'majority'
          ? `验收通过：${passed}/${total}（需要 ${required} 位），可以签字了。`
          : '全部验收席位通过，可以签字了。',
      })
    } else {
      updateTasks(pending.stage, current => markStageTasks(current, 'working'))
      store.appendMessage(roomId, {
        kind: 'system',
        text: policy === 'majority'
          ? `${name} 投了退回：${passed}/${total} 通过、${rejected} 退回（需要 ${required} 位通过）；这一轮仍未通过。`
          : `${name} 打回；其余验收席位不再等待，返工后重跑验收命令。`,
      })
      const current = store.readRoom(roomId)
      const moved = transitionStudio(current?.closure ?? 'verifying', 'verdict_reject')
      if (moved.ok) {
        store.updateRoom(roomId, roomState => {
          roomState.closure = moved.state
          return { events: [studioTransitionEvent(moved, 'verdict_reject', pending.verifier, {}, 'Verifier 打回')] }
        })
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
    if (stage.state !== 'active') reject('conflict', '这个阶段不在待验收状态')
    if (room.closure === 'rejected' || room.closure === 'signed') {
      reject('conflict', `房间已${room.closure === 'rejected' ? '拒绝' : '签字'}，不能发起复核`)
    }
    const messages = store.readMessages(roomId)
    const manual = stage.manual === true
    const ledger = store.readEvidence?.(roomId)
    const outcome = manual
      ? manualReviewState({ room, evidence: ledger, messages, stageIndex })
      : reviewState({ room, evidence: ledger, messages, stageIndex })
    if (outcome.state === 'pass') reject('conflict', '本阶段全部验收席位已经有 PASS 了')
    if (outcome.state === 'reject') reject('conflict', '验收已被打回；先返工并重新跑验收命令')
    if (outcome.state === 'failed') reject('conflict', '最新验收命令没有通过；先返工并重新跑验收命令')
    const ids = verifierIds(room)
    if (ids.length === 0) reject('conflict', '房间没有验收席位')
    const evidence = outcome.evidence
    if (evidence === undefined || evidence === null) {
      reject('conflict', manual ? '还没有本阶段的产物证据' : '还没有本阶段的验收命令证据')
    }
    if (room.closure === 'executing') {
      const moved = transitionStudio(room.closure, 'submit_evidence', {
        manual,
        exitCode: evidence.meta?.exit,
      })
      if (!moved.ok) reject('conflict', moved.error)
      store.updateRoom(roomId, current => {
        if (current.closure !== 'executing') return null
        current.closure = moved.state
        return { events: [studioTransitionEvent(moved, 'submit_evidence', 'verifier', { manual }, manual ? '人工证据就绪' : '验收命令通过')] }
      })
    }
    if (round !== null) {
      if (round.evidenceId === evidence.id) reject('conflict', '上一次复核还没有结束')
      for (const [seat, pending] of round.requests) {
        clearTimeout(pending.timer)
        clearTimeout(pending.reminder)
        staleSeats.add(seat)
      }
      store.appendEvent(roomId, 'review.restarted', {
        stage: stageIndex,
        from: round.evidenceId,
        to: evidence.id,
      })
      round = null
    }
    const targets = outcome.state === 'pending' ? outcome.missing : ids
    if (targets.length === 0) reject('conflict', '所有验收席位都已回报')

    const meta = evidence.meta
    const reviewGuidance = reviewGuidanceFor(room)
    const nextRound = {
      stage: stageIndex,
      evidenceId: evidence.id,
      command: manual ? '' : meta.command,
      exit: manual ? null : meta.exit,
      total: ids.length,
      required: ids.length,
      passed: outcome.verdicts.filter(message => message.meta?.pass === true).length,
      rejects: outcome.verdicts.filter(message => message.meta?.pass !== true).length,
      requests: new Map(),
    }
    round = nextRound
    store.updateRoom(roomId, current => {
      current.reviewRetriedAt = Date.now()
      return { events: [] }
    })
    store.appendEvent(roomId, 'review.requested', {
      stage: stageIndex,
      evidenceId: evidence.id,
      verifiers: targets,
    })
    const advisorResult = await advisor?.advice?.({
      mode: 'review',
      goal: room.goal,
      stage: { title: stage.title, acceptance: stage.acceptance ?? '', manual },
      evidence: {
        id: evidence.id,
        text: evidence.text,
        command: meta.command,
        exit: meta.exit,
        diff: meta.diff,
        files: meta.files,
        artifacts: meta.artifacts,
      },
    }) ?? { available: false, advice: [] }
    const advisorLines = Array.isArray(advisorResult.advice) ? advisorResult.advice : []
    const shadow = room.shadowReview === true
    const promptLines = shadow ? [] : advisorLines
    if (advisorLines.length > 0) {
      const text = advisorLines
        .map(item => item.summary ?? [...(item.reasons ?? []), ...(item.risks ?? [])].join('；'))
        .filter(Boolean)
        .join('；')
      store.appendMessage(roomId, {
        kind: 'advisor_advice',
        authorId: 'system',
        text: `${shadow ? '影子评审（暂时仅记录评估建议）' : '评估建议（仅参考，不替代验收员）'}：${text}`,
        meta: {
          stage: stageIndex,
          evidenceId: evidence.id,
          advice: advisorLines,
          shadow,
          available: advisorResult.available === true,
          ...(advisorResult.model === undefined ? {} : { model: advisorResult.model }),
          ...(advisorResult.version === undefined ? {} : { version: advisorResult.version }),
        },
      })
    }
    const failures = []
    for (const verifier of targets) {
      const verifierName = seatDisplayName(room, verifier)
      const verifierMention = seatMention(room, verifier)
      if (typeof verifierName !== 'string' || verifierName === '') {
        failures.push(`${verifier}: 没有席位名字`)
        continue
      }
      if (room.worktrees?.[verifier] !== undefined && typeof room.branch === 'string') {
        try {
          workspaceOf(room).refreshReviewCopy({ path: room.worktrees[verifier], branch: room.branch, source: room.sourceRepo, from: room.repoPath })
        } catch (error) {
          failures.push(`${verifierName}: 复核副本不可用（${error?.message ?? error}）`)
          store.appendMessage(roomId, { kind: 'system', text: `复核副本不可用（${verifierName}）：${error?.message ?? error}` })
          continue
        }
      }
      const verifierPort = room.ports?.[verifier]
      const prompt = manual
        ? [
            `${verifierMention || `@${verifierName}`} 你现在是验收席位${ids.length > 1 ? `（${targets.indexOf(verifier) + 1}/${targets.length} 个本轮请求）` : ''}。`,
            '独立复核：以本轮产物证据、改动和验收命令为准；执行对话只作背景，不作为判定依据。',
            buildSeatHandoff({ room, messages }),
            ...(promptLines.length > 0
              ? [`评估建议（仅参考，不替代你的判定）：${promptLines.map(item => item.summary ?? [...(item.reasons ?? []), ...(item.risks ?? [])].join('；')).filter(Boolean).join('；')}`]
              : []),
            `工作目录：${room.worktrees?.[verifier] ?? room.repoPath ?? '(未设置)'}`,
            ...(verifierPort === undefined ? [] : [`如需起本地服务，用 PORT=${verifierPort}。`]),
            '产物证据：',
            '```',
            tail(evidence.text, 2000),
            '```',
            '请自己打开产物核对；这是人工验收阶段，没有验收命令。',
            '只评审交付产物；`.crew/` 下是房间运行中的状态记录，不属于交付内容，忽略它。',
            ...(ids.length > 1 ? [`本阶段共有 ${ids.length} 个验收席位；全部 PASS 才能签字，任一 REJECT 都会退回。`] : []),
            ...(reviewGuidance === '' ? [] : [reviewGuidance]),
            '第一行必须是 PASS 或 REJECT，单独一行；不要写「验收通过」代替 PASS，也不要 @ 任何人。',
            VERDICT_FORMAT,
            '判定不清就写 REJECT。',
            INTERNAL_PROMPT_MARKER,
          ].join('\n')
        : [
            `${verifierMention || `@${verifierName}`} 你现在是验收席位${ids.length > 1 ? `（${targets.indexOf(verifier) + 1}/${targets.length} 个本轮请求）` : ''}。`,
            '独立复核：以本轮验收证据、改动和验收命令为准；执行对话只作背景，不作为判定依据。',
            buildSeatHandoff({ room, messages }),
            ...(promptLines.length > 0
              ? [`评估建议（仅参考，不替代你的判定）：${promptLines.map(item => item.summary ?? [...(item.reasons ?? []), ...(item.risks ?? [])].join('；')).filter(Boolean).join('；')}`]
              : []),
            `工作目录：${room.worktrees?.[verifier] ?? room.repoPath ?? '(未设置)'}`,
            ...(verifierPort === undefined ? [] : [`如需起本地服务，用 PORT=${verifierPort}。`]),
            `验收命令：${meta.command}`,
            `退出码：${meta.exit === null ? '无' : meta.exit}`,
            '命令输出：',
            '```',
            tail(meta.output, 1000),
            '```',
            '改动：',
            '```diff',
            tail(meta.diff, 4000),
            '```',
            '',
            '请自己打开改动过的文件核对；必要时自己重跑验收命令，不要把上面的输出当成唯一依据。',
            '只评审交付改动；`.crew/` 下是房间运行中的状态记录，不属于交付内容，忽略它。',
            ...(ids.length > 1 ? [`本阶段共有 ${ids.length} 个验收席位；全部 PASS 才能签字，任一 REJECT 都会退回。`] : []),
            ...(reviewGuidance === '' ? [] : [reviewGuidance]),
            '第一行必须是 PASS 或 REJECT，单独一行；不要写「验收通过」代替 PASS，也不要 @ 任何人。',
            VERDICT_FORMAT,
            '判定不清就写 REJECT。',
            INTERNAL_PROMPT_MARKER,
          ].join('\n')

      const request = {
        stage: stageIndex,
        verifier,
        command: manual ? '' : meta.command,
        exit: manual ? null : meta.exit,
        evidenceId: evidence.id,
        timer: null,
        reminder: null,
      }
      nextRound.requests.set(verifier, request)
      request.reminder = setTimeout(() => {
        if (round !== nextRound || round.requests.get(verifier) !== request) return
        void sendToSeat(verifier, `${verifierMention || `@${verifierName}`} 复核还没有结论。请现在只回复一行 PASS 或 REJECT；不要继续调研，不要调用工具。`).catch(() => {})
      }, REVIEW_REMINDER).unref()
      request.timer = setTimeout(() => {
        if (round !== nextRound || round.requests.get(verifier) !== request) return
        round.requests.delete(verifier)
        clearTimeout(request.reminder)
        store.appendEvent(roomId, 'review.timeout', { stage: stageIndex, verifier })
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${verifierName} 复核超时，没有收到验收结论；这一轮仍未通过。`,
        })
        if (round.requests.size === 0) {
          const passed = round.passed
          const total = round.total
          const timedOut = [...(round.timedOut ?? []), verifier]
          round = null
          store.appendMessage(roomId, {
            kind: 'system',
            text: `本轮复核结束：${passed}/${total} 个验收席位 PASS；其余未回报，不能签字。可以重新发起复核。`,
            meta: { kind: 'review_timeout', stage: stageIndex, verifiers: timedOut },
          })
        } else {
          round.timedOut = [...(round.timedOut ?? []), verifier]
        }
      }, REVIEW_TIMEOUT).unref()
      const source = [...messages].reverse().find(message => (
        message.kind === 'evidence' &&
        message.meta?.kind === 'turn' &&
        (message.meta?.stage ?? 0) === stageIndex
      ))?.authorId
      try {
        await handoffTrigger({
          room,
          stage,
          index: stageIndex,
          from: source ?? evidence.authorId ?? room.leadSeat ?? 'you',
          to: verifier,
          reason: 'review',
          prompt,
          acceptance: stage.acceptance ?? '',
          evidence,
          verdict: outcome.verdicts?.at(-1) ?? null,
        })
      } catch (error) {
        clearTimeout(request.timer)
        clearTimeout(request.reminder)
        nextRound.requests.delete(verifier)
        failures.push(`${verifierName}: ${error?.message ?? error}`)
        store.appendMessage(roomId, {
          kind: 'system',
          text: `复核请求发送失败（${verifierName}）：${error?.message ?? error}`,
        })
      }
    }
    if (nextRound.requests.size === 0) {
      round = null
      reject('conflict', `复核请求没有发出：${failures.join('；') || '没有可用验收席位'}`)
    }
    return { requested: true, stage: stageIndex, verifiers: [...nextRound.requests.keys()] }
  }

  return { request, consume, isBusy }
}
