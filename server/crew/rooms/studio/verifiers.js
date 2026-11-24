// 验收员只看“当前这轮结果证据”上的结论；旧轮的 PASS/REJECT 不参与本轮判定。
import { verifierIds } from '../../room-members.js'
import { reworkFloor } from '../../../../shared/attempt.js'
import { verdictPassed } from '../../../../shared/judgment.js'
import { REVIEW_STATE } from '../../../../shared/states.js'
export { reworkFloor, verifierIds }

// 本轮复核的验收员在发起复核时固定；加成员不回头改已经发起的这一轮。
const reviewersOf = (room, stageIndex) => {
  const stored = room?.stages?.[stageIndex]?.reviewers
  return Array.isArray(stored) && stored.length > 0 ? stored : verifierIds(room)
}

const verdictOutcome = ({ ids, verdicts }) => {
  const total = ids.length
  const required = total
  const passes = verdicts.filter(verdictPassed).length
  const rejects = verdicts.filter(message => !verdictPassed(message))
  const missing = ids.filter(id => !verdicts.some(message => message.authorId === id))
  const state = total === 0
    ? REVIEW_STATE.none
    : passes >= required
      ? REVIEW_STATE.pass
      : rejects.length > total - required
        ? REVIEW_STATE.reject
        : missing.length === 0
          ? REVIEW_STATE.reject
          : REVIEW_STATE.pending
  return { state, total, required, received: verdicts.length, missing, verdicts, rejects }
}

// 只有真的动过工具或产出文件的回合，才会让之前的证据过期；
// 成员后来补的一句说明不应该把已经验过的结果作废。
const turnDidWork = message => {
  const meta = message.meta ?? {}
  let toolCalls = Number(meta.toolCalls ?? 0)
  if (!Number.isFinite(toolCalls) || toolCalls === 0) {
    try {
      toolCalls = Number(JSON.parse(String(meta.output ?? '')).toolCalls ?? 0)
    } catch {
      toolCalls = 0
    }
  }
  return (Array.isArray(meta.files) && meta.files.length > 0) ||
    (Array.isArray(meta.artifacts) && meta.artifacts.length > 0) ||
    toolCalls > 0
}

const turnFloor = (messages, stageIndex) => (
  messages.reduce((floor, message) => (
    message.kind === 'evidence' &&
    message.meta?.kind === 'turn' &&
    (message.meta?.stage ?? 0) === stageIndex &&
    turnDidWork(message)
      ? Math.max(floor, message.seq ?? 0)
      : floor
  ), -1)
)

const evidenceFloor = (messages, stageIndex) => Math.max(reworkFloor(messages, stageIndex), turnFloor(messages, stageIndex))

const ledgerOf = (evidence, messages) => {
  const fromMessages = messages.filter(message => (
    message.kind === 'evidence' && message.meta?.kind === 'result'
  ))
  // 没有独立 ledger 时沿用消息账本（测试和旧调用都走这里）。
  if (!Array.isArray(evidence)) return fromMessages
  // 有 ledger 时以 ledger 为准；只补系统刚写入、ledger 还没带上的结果凭证。
  const fromSystem = messages.filter(message => (
    message.kind === 'evidence' &&
    message.meta?.kind === 'result' &&
    message.authorId === 'system'
  ))
  const byId = new Map()
  for (const item of [...evidence, ...fromSystem]) {
    const key = item?.id ?? `${item?.seq ?? ''}:${item?.meta?.stage ?? ''}`
    if (!byId.has(key)) byId.set(key, item)
  }
  return [...byId.values()]
}

// 只看最新一条结果证据：执行官交回一次，就对应一次复核。
export const resultEvidenceFor = (room, evidence, messages, stageIndex) => {
  const floor = evidenceFloor(messages, stageIndex)
  return [...ledgerOf(evidence, messages)].reverse().find(item => (
    (item.meta?.stage ?? 0) === stageIndex &&
    (item.seq ?? 0) > floor &&
    item.meta?.kind === 'result' &&
    (room.demo === true || item.meta?.simulated !== true)
  ))
}

export const reviewState = ({ room, evidence, messages, stageIndex }) => {
  const ids = reviewersOf(room, stageIndex)
  const found = resultEvidenceFor(room, evidence, messages, stageIndex)
  if (found === undefined) {
    return { state: 'none', evidence: null, total: ids.length, received: 0, missing: ids, verdicts: [], rejects: [] }
  }
  const floor = reworkFloor(messages, stageIndex)
  const latest = new Map()
  for (const message of messages) {
    if (message.kind !== 'verdict' || (message.meta?.stage ?? 0) !== stageIndex) continue
    if ((message.seq ?? 0) <= floor) continue
    if (message.meta?.evidenceId !== found.id) continue
    latest.set(message.authorId, message)
  }
  const verdicts = ids.map(id => latest.get(id)).filter(message => message !== undefined)
  const outcome = verdictOutcome({ ids, verdicts })
  return { ...outcome, evidence: found }
}

// 复核超时是持久事实：最新一条超时标记晚于本阶段最后一次 verdict，才算当前仍超时。
export const latestReviewTimeout = (messages, stageIndex) => [...messages]
  .reverse()
  .find(message => (
    message.kind === 'system' &&
    message.meta?.kind === 'review_timeout' &&
    (message.meta.stage ?? 0) === stageIndex
  ))
