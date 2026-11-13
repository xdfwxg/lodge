import { budgetStatus } from './budget.js'
import { markSeatRead } from './watermarks.js'
import { workContract } from './prompt-modes.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { reject } from './result.js'
import { parseVerdict, REVIEW_TIMEOUT, tail } from './live-turn-utils.js'
import { workspaceOf } from './live-workspace.js'
import { manualReviewState, reviewState, verifierIds } from './verifiers.js'
import { markStageTasks } from './tasks.js'
import { reviewGuidanceFor } from './orchestration/index.js'
import { seatDisplayName } from './seat-labels.js'

export const createReviewCoordinator = ({ store, roomId, emit, sendToSeat, updateTasks }) => {
  let round = null

  const isBusy = () => round !== null && round.requests.size > 0

  const consume = ({ turn, seat, turnId, room }) => {
    const pending = round?.requests.get(seat)
    if (pending === undefined) return false
    round.requests.delete(seat)
    clearTimeout(pending.timer)
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
        blind: true,
        verifier: pending.verifier,
        turnId,
        simulated: false,
      },
    })
    store.appendEvent(roomId, 'verifier.verdict', { stage: pending.stage, verifier: pending.verifier, pass, blind: true, turnId })
    if (!pass) {
      updateTasks(pending.stage, current => markStageTasks(current, 'working'))
      for (const [remainingSeat, request] of round.requests) {
        clearTimeout(request.timer)
        store.appendEvent(roomId, 'review.cancelled', {
          stage: pending.stage,
          verifier: remainingSeat,
          reason: `${name} 已打回`,
        })
      }
      round.requests.clear()
      round = null
      store.appendMessage(roomId, {
        kind: 'system',
        text: `${name} 打回；其余验收席位不再等待，返工后重跑验收命令。`,
      })
    } else {
      round.passed = (round.passed ?? 0) + 1
      if (round.requests.size > 0) {
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${name} PASS；还有 ${round.requests.size} 个验收席位复核中。`,
        })
      } else {
        const passed = round.passed
        const total = round.total
        round = null
        if (passed === total) {
          updateTasks(pending.stage, current => markStageTasks(current, 'done'))
          store.appendMessage(roomId, { kind: 'system', text: '全部验收席位 PASS，等你签字。' })
        } else {
          store.appendMessage(roomId, {
            kind: 'system',
            text: `本轮复核结束：${passed}/${total} 个验收席位 PASS；其余未回报，不能签字。`,
          })
        }
      }
    }
    return true
  }

  const request = async stageIndex => {
    if (round !== null) reject('conflict', '上一次复核还没有结束')
    const room = store.readRoom(roomId)
    const stage = room?.stages?.[stageIndex]
    if (stage === undefined || (stage.kind !== 'deliverable' && stage.manual !== true)) {
      reject('invalid', '这个阶段不是交付型')
    }
    if (stage.state !== 'active') reject('conflict', '这个阶段不在待验收状态')
    if (room.closure === 'rejected' || room.closure === 'signed') {
      reject('conflict', `房间已${room.closure === 'rejected' ? '拒绝' : '签字'}，不能发起复核`)
    }
    const budget = budgetStatus(room, store.readRooms())
    if (!budget.ok) reject('conflict', budget.message)
    if (room.roomType === 'studio') {
      store.updateRoom(roomId, current => {
        if (current.closure !== 'executing') return null
        current.closure = 'verifying'
        return { events: [{ type: 'room.closure', payload: { closure: 'verifying' } }] }
      })
    }

    const messages = store.readMessages(roomId)
    const manual = stage.manual === true
    const outcome = manual
      ? manualReviewState({ room, messages, stageIndex })
      : reviewState({ room, messages, stageIndex })
    if (outcome.state === 'pass') reject('conflict', '本阶段全部验收席位已经有 PASS 了')
    if (outcome.state === 'reject') reject('conflict', '验收已被打回；先返工并重新跑验收命令')
    if (outcome.state === 'failed') reject('conflict', '最新验收命令没有通过；先返工并重新跑验收命令')
    const ids = verifierIds(room)
    if (ids.length === 0) reject('conflict', '房间没有验收席位')
    const evidence = outcome.evidence
    if (evidence === undefined || evidence === null) {
      reject('conflict', manual ? '还没有本阶段的产物证据' : '还没有本阶段的验收命令证据')
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
      passed: outcome.verdicts.filter(message => message.meta?.pass === true).length,
      requests: new Map(),
    }
    round = nextRound
    store.appendEvent(roomId, 'review.requested', {
      stage: stageIndex,
      evidenceId: evidence.id,
      verifiers: targets,
    })
    const failures = []
    for (const verifier of targets) {
      const verifierName = room.seatNames?.[verifier]
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
            `@${verifierName} 你现在是验收席位${ids.length > 1 ? `（${targets.indexOf(verifier) + 1}/${targets.length} 个本轮请求）` : ''}。`,
            ...workContract('verifier'),
            '盲审：你只拿到目标、约束和本轮产物证据，不读取执行席位的对话；判定只看证据和代码。',
            buildSeatHandoff({ room, messages }),
            `工作目录：${room.worktrees?.[verifier] ?? room.repoPath ?? '(未设置)'}`,
            ...(verifierPort === undefined ? [] : [`如需起本地服务，用 PORT=${verifierPort}。`]),
            '产物证据：',
            '```',
            tail(evidence.text, 4000),
            '```',
            '请自己打开产物核对；这是人工验收阶段，没有验收命令。',
            '只评审交付产物；`.crew/` 下是房间运行中的状态记录，不属于交付内容，忽略它。',
            ...(ids.length > 1 ? [`本阶段共有 ${ids.length} 个验收席位；全部 PASS 才能签字，任一 REJECT 都会退回。`] : []),
            ...(reviewGuidance === '' ? [] : [reviewGuidance]),
            '第一行必须是 PASS 或 REJECT，单独一行；不要写「验收通过」代替 PASS，也不要 @ 任何人。',
            '判定不清就写 REJECT。',
          ].join('\n')
        : [
            `@${verifierName} 你现在是验收席位${ids.length > 1 ? `（${targets.indexOf(verifier) + 1}/${targets.length} 个本轮请求）` : ''}。`,
            ...workContract('verifier'),
            '盲审：你只拿到目标、约束、本轮验收证据和改动，不读取执行席位的对话；判定只看证据和代码。',
            buildSeatHandoff({ room, messages }),
            `工作目录：${room.worktrees?.[verifier] ?? room.repoPath ?? '(未设置)'}`,
            ...(verifierPort === undefined ? [] : [`如需起本地服务，用 PORT=${verifierPort}。`]),
            `验收命令：${meta.command}`,
            `退出码：${meta.exit === null ? '无' : meta.exit}`,
            '命令输出：',
            '```',
            tail(meta.output, 4000),
            '```',
            '改动：',
            '```diff',
            tail(meta.diff, 6000),
            '```',
            '',
            '请自己打开改动过的文件核对；必要时自己重跑验收命令，不要把上面的输出当成唯一依据。',
            '只评审交付改动；`.crew/` 下是房间运行中的状态记录，不属于交付内容，忽略它。',
            ...(ids.length > 1 ? [`本阶段共有 ${ids.length} 个验收席位；全部 PASS 才能签字，任一 REJECT 都会退回。`] : []),
            ...(reviewGuidance === '' ? [] : [reviewGuidance]),
            '第一行必须是 PASS 或 REJECT，单独一行；不要写「验收通过」代替 PASS，也不要 @ 任何人。',
            '判定不清就写 REJECT。',
          ].join('\n')

      const request = {
        stage: stageIndex,
        verifier,
        command: manual ? '' : meta.command,
        exit: manual ? null : meta.exit,
        evidenceId: evidence.id,
        timer: null,
      }
      nextRound.requests.set(verifier, request)
      request.timer = setTimeout(() => {
        if (round !== nextRound || round.requests.get(verifier) !== request) return
        round.requests.delete(verifier)
        store.appendEvent(roomId, 'review.timeout', { stage: stageIndex, verifier })
        store.appendMessage(roomId, {
          kind: 'system',
          text: `${verifierName} 复核超时，没有收到验收结论；这一轮仍未通过。`,
        })
        if (round.requests.size === 0) {
          const passed = round.passed
          const total = round.total
          round = null
          store.appendMessage(roomId, {
            kind: 'system',
            text: `本轮复核结束：${passed}/${total} 个验收席位 PASS；其余未回报，不能签字。`,
          })
        }
      }, REVIEW_TIMEOUT).unref()
      markSeatRead({ store, roomId, seat: verifier, emit })
      try {
        const sent = await sendToSeat(verifier, prompt)
        if (sent.messageId !== null) {
          store.updateRoom(roomId, current => {
            current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
            return { events: [] }
          })
        }
      } catch (error) {
        clearTimeout(request.timer)
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
    const waiting = [...nextRound.requests.keys()].map(id => `@${room.seatNames?.[id] ?? id}`)
    store.appendMessage(roomId, {
      kind: 'system',
      text: `已通知验收席位 ${waiting.join('、')} 复核阶段 ${stageIndex + 1}「${stage.title}」。`,
    })
    return { requested: true, stage: stageIndex, verifiers: [...nextRound.requests.keys()] }
  }

  return { request, consume, isBusy }
}
