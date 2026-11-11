const deny = (reason, error) => ({ ok: false, reason, error })

export const gateFor = (room, index, messages) => {
  const stage = Number.isInteger(index) ? room.stages[index] : undefined
  if (stage === undefined) return deny('invalid', '没有这个阶段')
  if (stage.state !== 'active') return deny('conflict', '这个阶段不在待验收状态')
  if (room.openQuestion !== null && room.openQuestion !== undefined) {
    return deny('conflict', '还有问题没答，先答再确认')
  }
  if (stage.manual === true) {
    // 只认最新一条本阶段证据；返工回合之后不能被旧的“产物就绪”蒙混过去。
    const latestEvidence = [...messages]
      .filter(message => (
        message.kind === 'evidence' &&
        message.meta?.stage === index &&
        (room.demo === true || message.meta?.simulated !== true)
      ))
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .at(-1)
    if (latestEvidence?.meta?.kind !== 'manual') return deny('conflict', '执行还没有产出，不能验收')
    return { ok: true, stage }
  }
  if (stage.kind !== 'deliverable') return { ok: true, stage }
  const acceptance = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
  if (acceptance === '') {
    return deny('conflict', '交付型阶段没有验收命令，不能验收')
  }
  const isCommandEvidence = message => (
    message.kind === 'evidence' &&
    message.meta?.stage === index &&
    (room.demo === true || message.meta?.simulated !== true) &&
    (message.meta?.kind === 'command' || (room.demo === true && message.meta?.simulated === true)) &&
    message.meta?.exit === 0 &&
    typeof message.meta?.command === 'string' &&
    message.meta.command.trim() === acceptance
  )

  const ordered = [...messages].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
  const verdicts = ordered.filter(message => message.kind === 'verdict' && message.meta?.stage === index)
  const latest = verdicts.at(-1)
  const evidenceBetween = (floor, ceiling) => ordered.filter(message => (
    message.kind === 'evidence' &&
    message.meta?.stage === index &&
    (room.demo === true || message.meta?.simulated !== true) &&
    (message.seq ?? 0) > floor &&
    (message.seq ?? 0) < ceiling
  ))

  if (latest === undefined) {
    const phaseEvidence = evidenceBetween(-1, Number.POSITIVE_INFINITY)
    if (phaseEvidence.length === 0) {
      return deny('conflict', '还没有本阶段的证据，不能验收')
    }
    if (!isCommandEvidence(phaseEvidence.at(-1))) {
      return deny('conflict', '还没有通过验收命令的证据（exit 0），不能签字')
    }
    // 只有显式声明了“没有验收席位”的单人模板才允许直接由人签字；未知席位表仍按有 verifier 处理。
    const hasVerifier = !(Array.isArray(room.verifiers) && room.verifiers.length === 0)
    if (room.demo === true || hasVerifier) {
      return deny('conflict', room.demo === true ? '还没有本阶段的 验收 PASS，不能验收' : '还没有验收席位的 PASS，不能签字')
    }
    return { ok: true, stage }
  }

  if (latest.meta?.pass !== true) {
    return deny('conflict', '验收复核未通过，先返工')
  }

  // PASS 之前必须有一段“上一次 REJECT 之后”的新证据；否则只是口头翻案。
  const previousReject = [...verdicts].reverse().slice(1).find(message => message.meta?.pass !== true)
  const floor = previousReject?.seq ?? -1
  const phaseEvidence = evidenceBetween(floor, latest.seq ?? Number.POSITIVE_INFINITY)
  if (phaseEvidence.length === 0) {
    return deny('conflict', previousReject === undefined ? '还没有本阶段的证据，不能验收' : '返工后还没有新的证据，不能验收')
  }
  const referenced = typeof latest.meta?.evidenceId === 'string'
    ? ordered.find(message => message.id === latest.meta.evidenceId)
    : undefined
  const covered = referenced !== undefined && (referenced.seq ?? 0) > floor ? referenced : phaseEvidence.at(-1)
  if (!isCommandEvidence(covered)) {
    return deny('conflict', '复核没有对应的验收命令证据（exit 0），不能签字')
  }
  return { ok: true, stage }
}
