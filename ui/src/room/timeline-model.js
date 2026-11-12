const PROCESS_KINDS = new Set(['dispatch', 'activity', 'conclusion'])

const isEmptyChat = message => message.kind === 'chat' && String(message.text ?? '').trim() === ''

// 派活、心跳、整房结论与原始回合是过程；对话、结果和里程碑留在主视线。
export const isProcessMessage = message => PROCESS_KINDS.has(message.kind) ||
  (message.kind === 'evidence' && message.meta?.kind === 'turn')

export const buildTimeline = messages => {
  const evidenceById = new Map()
  for (const message of messages) {
    if (message.kind === 'evidence') evidenceById.set(message.id, message)
  }
  const consumed = new Set()
  const evidenceFor = new Map()
  for (const message of messages) {
    if (message.kind !== 'verdict') continue
    let evidence = message.meta?.evidenceId === undefined
      ? undefined
      : evidenceById.get(message.meta.evidenceId)
    if (evidence === undefined) {
      for (const candidate of messages) {
        if (candidate.kind !== 'evidence' || candidate.meta?.stage !== message.meta?.stage) continue
        if ((candidate.seq ?? 0) > (message.seq ?? 0)) break
        evidence = candidate
      }
    }
    if (evidence === undefined) continue
    consumed.add(evidence.id)
    evidenceFor.set(message.id, evidence)
  }
  const process = messages.filter(isProcessMessage)
  const visible = messages.filter(message => (
    !isProcessMessage(message) &&
    !isEmptyChat(message) &&
    !(message.kind === 'evidence' && consumed.has(message.id))
  ))
  let trailingStart = visible.length
  while (trailingStart > 0) {
    const message = visible[trailingStart - 1]
    if (message.kind !== 'chat' || message.authorId !== 'you') break
    trailingStart -= 1
  }
  return { visible, process, evidenceFor, trailingStart }
}
