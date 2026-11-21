// 多验收成员只看“当前这轮验收命令证据”上的结论；旧轮的 PASS/REJECT 不参与本轮判定。
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

// 只有真的动过工具或产出文件的回合，才会让之前的凭证过期；
// 成员后来补的一句说明不应该把已经验收的结果作废。
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

const ledgerOf = (evidence, messages) => Array.isArray(evidence)
  ? evidence
  : messages.filter(message => (
    message.kind === 'evidence' && (message.meta?.kind === 'command' || message.meta?.kind === 'manual')
  ))

// 产品自己跑的那条检查（不是验收命令）；最近一条失败时，这一步还没资格交给人。
export const latestAutoCheck = (messages, stageIndex, floor = -1) => [...messages]
  .reverse()
  .find(message => (
    message.kind === 'evidence' &&
    message.meta?.auto === true &&
    (message.meta?.stage ?? 0) === stageIndex &&
    (message.seq ?? 0) > floor
  ))

// 只看最新一条验收命令证据；失败的那一条会让此前所有 PASS 作废。
export const commandEvidenceFor = (room, evidence, messages, stageIndex) => {
  const stage = room?.stages?.[stageIndex]
  const acceptance = typeof stage?.acceptance === 'string' ? stage.acceptance.trim() : ''
  if (stage?.kind !== 'deliverable' || acceptance === '') return undefined
  const floor = evidenceFloor(messages, stageIndex)
  return [...ledgerOf(evidence, messages)].reverse().find(item => (
    (item.seq ?? 0) > floor &&
    (item.meta?.stage ?? 0) === stageIndex &&
    (item.meta?.kind === 'command' || (room.demo === true && item.meta?.simulated === true)) &&
    typeof item.meta?.command === 'string' &&
    item.meta.command.trim() === acceptance
  ))
}

export const manualEvidenceFor = (room, evidence, messages, stageIndex) => {
  const stage = room?.stages?.[stageIndex]
  if (stage?.manual !== true) return undefined
  const floor = evidenceFloor(messages, stageIndex)
  return [...ledgerOf(evidence, messages)].reverse().find(item => (
    (item.meta?.stage ?? 0) === stageIndex &&
    (item.seq ?? 0) > floor &&
    item.meta?.kind === 'manual' &&
    (room.demo === true || item.meta?.simulated !== true)
  ))
}

// 人工验收不是绕过 Verifier：结果证据也要经过独立 Verifier，再交给人确认。
export const manualReviewState = ({ room, evidence, messages, stageIndex }) => {
  const ids = reviewersOf(room, stageIndex)
  const found = manualEvidenceFor(room, evidence, messages, stageIndex)
  if (found === undefined) {
    return { state: ids.length === 0 ? 'none' : 'pending', evidence: null, total: ids.length, received: 0, missing: ids, verdicts: [], rejects: [] }
  }
  const latest = new Map()
  for (const message of messages) {
    if (message.kind !== 'verdict' || (message.meta?.stage ?? 0) !== stageIndex) continue
    if ((message.seq ?? 0) <= (found.seq ?? -1)) continue
    if (message.meta?.evidenceId !== found.id) continue
    latest.set(message.authorId, message)
  }
  const verdicts = ids.map(id => latest.get(id)).filter(message => message !== undefined)
  const outcome = verdictOutcome({ ids, verdicts,  })
  return { ...outcome, evidence: found }
}

export const reviewState = ({ room, evidence, messages, stageIndex }) => {
  const ids = reviewersOf(room, stageIndex)
  const found = commandEvidenceFor(room, evidence, messages, stageIndex)
  if (found === undefined) {
    return { state: 'none', evidence: null, total: ids.length, received: 0, missing: ids, verdicts: [], rejects: [] }
  }
  if (found.meta?.exit !== 0) {
    return { state: 'failed', evidence: found, total: ids.length, received: 0, missing: ids, verdicts: [], rejects: [] }
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
  const outcome = verdictOutcome({ ids, verdicts,  })
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
