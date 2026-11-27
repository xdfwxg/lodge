import { judgmentAnchorOf, normalizeJudgment } from '../../../../../../shared/judgment.js'
import { coverageClausesOf } from '../coverage.js'
import { gateRefusalsOf, gateSubmissionOf } from '../../../../../../shared/gate.js'
import { sanitizeUntrusted } from '../../../../../../shared/untrusted-text.js'
import { memberOf } from '../../../../room-members.js'
import { memberDisplayName } from '../../../../member-labels.js'
import { transitionAssignment } from '../../../../assignments.js'
import { lateReviewStillValid } from '../review-policy.js'
import { verdictRetryPrompt } from '../review-prompts.js'
import { REVIEW_CHECKS } from './checks/index.js'
import { settleReview } from './settle.js'

const nearNumber = (value, expected, tolerance = 2) => (
  Number.isInteger(value) && Number.isInteger(expected) && Math.abs(value - expected) <= tolerance
)

// 视觉判定必须引用平台这次渲染的像素检查；验收员自己编的数字不算核对。
export const visualMatchesAudit = (expected, visual) => {
  if (expected === null || expected === undefined) return true
  if (visual === null || visual === undefined || typeof visual.seen !== 'boolean') return false
  if (visual.seen === false) {
    return visual.colors === undefined || visual.colors === null
      ? visual.contrast === undefined || visual.contrast === null
      : false
  }
  // 空白画面不能声称“看到了”；颜色数允许两次渲染差一两个，但不是随便填。
  if (expected.blank === true) return false
  return nearNumber(visual.colors, expected.colors) && nearNumber(visual.contrast, expected.contrast)
}

// 证明没通过时给房间的话：带上干净副本里的真实失败原因，别只说“补证明”。
export const proofRejectionOf = pending => {
  const error = typeof pending?.proofError === 'string' ? pending.proofError : ''
  const failure = typeof pending?.proofFailure === 'string' ? pending.proofFailure : ''
  const detail = error !== '' ? error : (failure !== '' ? `证明入口在复核副本里跑红：${failure.slice(-600)}` : '')
  const advice = detail === ''
    ? ''
    : `\n${sanitizeUntrusted(detail, 800)}\n证明的辅助文件必须随交付走（例如 tools/），不要用 .lodge/、临时目录或工作区外的路径。`
  return `交付自带的证明在验收员的复核副本里没有跑绿，这一轮仍未通过；先让执行官补 lodge-proof.json。${advice}`
}

// 一位验收员的一回合收口：认出判定（工具或文本），过完 review/checks/ 里的规则，再把这一票落进房间。
// 规则本身在 checks/ 里，一条一个文件；这里只决定“这一票算不算数、算数之后交给谁”。
export const consumeVerdict = async ({
  store,
  roomId,
  session,
  turn,
  memberId,
  turnId,
  room,
  calls = [],
  runCommand,
  advanceStage = null,
  handoffTrigger,
}) => {
  // 新证据已经让旧复核作废时，忽略旧提示词触发的那一回合，等新回合的结论。
  if (session.takeStale(memberId)) return false
  const pending = session.requestOf(memberId)
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
  const textAnchor = gate === null ? judgmentAnchorOf('verdict', turn.reply) : null
  const refusals = gate === null ? gateRefusalsOf(calls, { type: 'verdict' }) : []
  // 判定工具拒了这次提交：模型以为交了，平台什么都没收到。把工具原话交回给它重交，
  // 而不是让它落回文字通道——文字判定带不了覆盖表，再催一次只会被覆盖规则作废。
  // 文字判的是“不通过”时照旧放行：退回不需要覆盖表，拒收后模型改判也算它自己的结论。
  if (refusals.length > 0 && (textAnchor === null || textAnchor === 'pass')) {
    const name = memberDisplayName(room, memberId)
    const refused = Number(pending.gateRefusedNudges ?? 0)
    if (refused < 2) {
      pending.gateRefusedNudges = refused + 1
      clearTimeout(pending.reminder)
      const clauses = coverageClausesOf({ room, stageIndex: pending.stage })
      void session.deliver(pending, verdictRetryPrompt({ clauses, refusals })).catch(() => {})
      return true
    }
    // 给房间的是事实，不给工具的字段原话：那几句是参数格式，人不需要看。
    session.expire(pending, `${name} 交的判定被工具拒了，没有形成结论；这一轮仍未通过。`, 'invalid')
    return true
  }
  // 判定走哪条通道由模型决定：工具调用，或首行 通过/不通过 + 文本 json。
  // 平台不替它选，也不因为“工具挂着”就否掉文字判定——两条通道后面过的是同一组检查：
  // 亲手验过的工具记录、覆盖表、反例、证明状态、受保护文件。只有两样都没有时才催。
  if (gate === null && textAnchor === null) {
    const name = memberDisplayName(room, memberId)
    // 交不出判定是模型的问题，不是房间的问题：给它两次“只交判定”的机会，
    // 每次都把工具名、参数形状和要覆盖的要求写全；两次都没有才停到人这里。
    const nudges = Number(pending.verdictNudges ?? 0)
    if (nudges < 2) {
      pending.verdictNudges = nudges + 1
      clearTimeout(pending.reminder)
      const clauses = coverageClausesOf({ room, stageIndex: pending.stage })
      void session.deliver(pending, verdictRetryPrompt({ clauses })).catch(() => {})
      return true
    }
    session.expire(pending, `${name} 没有提交验收判定，这一轮仍未通过。`, 'invalid')
    return true
  }
  let judgment = gate ?? normalizeJudgment({
    type: 'verdict',
    text: turn.reply,
    stage: pending.stage,
    evidenceId: pending.evidenceId,
    actorId: pending.verifier,
  })
  // 一次复核要过的规则都在 review/checks/：一条一个文件，按顺序跑。
  // 这里只负责把结果翻译成房间行为——催一次，或者作废这一拍。
  for (const check of REVIEW_CHECKS) {
    const hit = await check({
      pending, judgment, calls, room, memberId, store, roomId, runCommand, proofRejectionOf,
    })
    if (hit === null) continue
    if (hit.replace !== undefined) {
      judgment = hit.replace
      continue
    }
    if (pending[hit.flag] !== true) {
      pending[hit.flag] = true
      clearTimeout(pending.reminder)
      void session.deliver(pending, hit.nudge).catch(() => {})
      return true
    }
    session.expire(pending, hit.expire, 'invalid')
    return true
  }
  const round = session.current()
  round.requests.delete(memberId)
  session.clearTimers(pending)
  // 平台给过渲染图，就必须引用像素检查；看不到可以写 seen:false，但不能装作没这回事。
  const current = store.readRoom(roomId)
  const expected = (current?.previews ?? [])
    .find(item => item.stage === pending.stage && item.evidenceId === pending.evidenceId && item.audit)?.audit ?? null
  const visual = judgment.visual ?? null
  const visualOk = visualMatchesAudit(expected, visual)
  // 不在这里追问：复核回合已经结束，重问会让复核挂住；缺了就如实标记，交给交付卡和系统消息说明。
  const visualMissing = !visualOk
  const pass = judgment.decision === 'pass'
  // PASS 缺覆盖表在前面已经被退回；这里留一条记录，防止别的入口塞进无效判定。
  const coverageMissing = pass && (Array.isArray(judgment.coverage) ? judgment.coverage.length : 0) === 0
  const independent = room?.independence === 'vendor'
  const name = memberDisplayName(room, memberId)
  const spec = memberOf(room, pending.verifier)
  const verdictMessage = store.appendMessage(roomId, {
    kind: 'verdict',
    authorId: pending.verifier,
    text: judgment.platformRejected === 'proof'
      ? judgment.reason
      : gate === null ? (turn.reply || '复核回合没有给出文字结论。') : (judgment.reason || '验收员通过工具提交了判定。'),
    meta: {
      pass,
      judgment,
      reason: judgment.platformRejected === 'proof' ? judgment.reason : gate === null ? (turn.reply ?? '') : judgment.reason,
      roleKind: 'verifier',
      verifierProfile: spec?.roleProfile ?? name,
      mode: 'bot',
      stage: pending.stage,
      evidenceId: pending.evidenceId,
      review: true,
      independent,
      verifier: pending.verifier,
      turnId,
      simulated: false,
      ...(visualMissing ? { visualMissing: true } : {}),
      ...(coverageMissing ? { coverageMissing: true } : {}),
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
  if (coverageMissing) {
    store.appendMessage(roomId, {
      kind: 'system',
      text: `${name} 这次通过没有提交覆盖表；只能按文字判定。`,
      meta: { kind: 'coverage', stage: pending.stage },
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

  return settleReview({
    store,
    roomId,
    session,
    room,
    pending,
    judgment,
    gate,
    turn,
    name,
    pass,
    verdictMessage,
    reviewAssignment,
    advanceStage,
    handoffTrigger,
  })
}
