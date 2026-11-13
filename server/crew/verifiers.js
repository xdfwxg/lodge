// 多验收席位只看“当前这轮验收命令证据”上的结论；旧轮的 PASS/REJECT 不参与本轮判定。
export const verifierIds = room => (
  Array.isArray(room?.verifiers)
    ? room.verifiers.filter(id => typeof id === 'string' && id !== '')
    : []
)

export const verifierPolicyOf = room => (
  room?.verifierPolicy === 'majority' && verifierIds(room).length > 1 ? 'majority' : 'all'
)

export const quorumOf = (total, policy = 'all') => (
  policy === 'majority' ? Math.floor(total / 2) + 1 : total
)

const verdictOutcome = ({ ids, verdicts, policy }) => {
  const total = ids.length
  const required = quorumOf(total, policy)
  const passes = verdicts.filter(message => message.meta?.pass === true).length
  const rejects = verdicts.filter(message => message.meta?.pass !== true)
  const missing = ids.filter(id => !verdicts.some(message => message.authorId === id))
  const state = total === 0
    ? 'none'
    : passes >= required
      ? 'pass'
      : rejects.length > total - required
        ? 'reject'
        : missing.length === 0
          ? 'reject'
          : 'pending'
  return { state, total, required, received: verdicts.length, missing, verdicts, rejects }
}

export const reworkFloor = (messages, stageIndex) => (
  messages.reduce((floor, message) => (
    message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex
      ? Math.max(floor, message.seq ?? 0)
      : floor
  ), -1)
)

// 新的执行回合会让之前的凭证过期，但回合本身不是凭证；它只作为账本的排序下限。
const turnFloor = (messages, stageIndex) => (
  messages.reduce((floor, message) => (
    message.kind === 'evidence' &&
    message.meta?.kind === 'turn' &&
    (message.meta?.stage ?? 0) === stageIndex
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

// 人工验收不是绕过 Verifier：产物证据也要经过独立 Verifier，再交给人签字。
export const manualReviewState = ({ room, evidence, messages, stageIndex }) => {
  const ids = verifierIds(room)
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
  const outcome = verdictOutcome({ ids, verdicts, policy: verifierPolicyOf(room) })
  return { ...outcome, evidence: found }
}

export const reviewState = ({ room, evidence, messages, stageIndex }) => {
  const ids = verifierIds(room)
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
  const outcome = verdictOutcome({ ids, verdicts, policy: verifierPolicyOf(room) })
  return { ...outcome, evidence: found }
}
