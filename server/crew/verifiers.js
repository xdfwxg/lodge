// 多验收席位只看“当前这轮验收命令证据”上的结论；旧轮的 PASS/REJECT 不参与本轮判定。
export const verifierIds = room => (
  Array.isArray(room?.verifiers)
    ? room.verifiers.filter(id => typeof id === 'string' && id !== '')
    : []
)

export const reworkFloor = (messages, stageIndex) => (
  messages.reduce((floor, message) => (
    message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex
      ? Math.max(floor, message.seq ?? 0)
      : floor
  ), -1)
)

// 只看最新一条验收命令证据；失败的那一条会让此前所有 PASS 作废。
export const commandEvidenceFor = (room, messages, stageIndex) => {
  const stage = room?.stages?.[stageIndex]
  const acceptance = typeof stage?.acceptance === 'string' ? stage.acceptance.trim() : ''
  if (stage?.kind !== 'deliverable' || acceptance === '') return undefined
  const floor = reworkFloor(messages, stageIndex)
  return [...messages].reverse().find(message => (
    message.kind === 'evidence' &&
    (message.seq ?? 0) > floor &&
    (message.meta?.stage ?? 0) === stageIndex &&
    (message.meta?.kind === 'command' || (room.demo === true && message.meta?.simulated === true)) &&
    typeof message.meta?.command === 'string' &&
    message.meta.command.trim() === acceptance
  ))
}

export const reviewState = ({ room, messages, stageIndex }) => {
  const ids = verifierIds(room)
  const evidence = commandEvidenceFor(room, messages, stageIndex)
  if (evidence === undefined) {
    return { state: 'none', evidence: null, total: ids.length, received: 0, missing: ids, verdicts: [], rejects: [] }
  }
  if (evidence.meta?.exit !== 0) {
    return { state: 'failed', evidence, total: ids.length, received: 0, missing: ids, verdicts: [], rejects: [] }
  }
  const floor = reworkFloor(messages, stageIndex)
  const latest = new Map()
  for (const message of messages) {
    if (message.kind !== 'verdict' || (message.meta?.stage ?? 0) !== stageIndex) continue
    if ((message.seq ?? 0) <= floor) continue
    if (message.meta?.evidenceId !== evidence.id) continue
    latest.set(message.authorId, message)
  }
  const verdicts = ids.map(id => latest.get(id)).filter(message => message !== undefined)
  const rejects = verdicts.filter(message => message.meta?.pass !== true)
  const missing = ids.filter(id => !latest.has(id))
  const state = ids.length === 0
    ? 'none'
    : rejects.length > 0
      ? 'reject'
      : missing.length === 0
        ? 'pass'
        : 'pending'
  return {
    state,
    evidence,
    total: ids.length,
    received: verdicts.length,
    missing,
    verdicts,
    rejects,
  }
}
