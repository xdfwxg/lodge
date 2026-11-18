const PROCESS_KINDS = new Set(['activity', 'conclusion'])

const isEmptyChat = message => message.kind === 'chat' && String(message.text ?? '').trim() === ''

// 派活、心跳、整房结论与原始回合是过程；对话、结果和里程碑留在主视线。
export const isProcessMessage = message => PROCESS_KINDS.has(message.kind) ||
  (message.kind === 'evidence' && message.meta?.kind === 'turn')

// 服务重启后同一条发言可能先以流式占位落库，再以基座最终消息补一条；同席同时同文只留最终那条。
export const dedupeChatStreams = messages => {
  const finals = new Set(messages
    .filter(message => message.kind === 'chat' && !String(message.id).startsWith('stream:'))
    .map(message => `${message.authorId}|${message.ts}|${String(message.text ?? '').trim()}`))
  return messages.filter(message => (
    !(message.kind === 'chat' &&
      String(message.id).startsWith('stream:') &&
      finals.has(`${message.authorId}|${message.ts}|${String(message.text ?? '').trim()}`))
  ))
}

export const buildTimeline = messages => {
  messages = dedupeChatStreams(messages)
  // 人的重做标记和 human-context 是同一条输入的两种记录；主时间线只留后者，旧记录没有配对时照常显示。
  const humanContext = new Set(messages
    .filter(message => message.kind === 'human-context')
    .map(message => `${message.meta?.stage ?? ''}|${String(message.text ?? '').trim()}`))
  const isProcess = message => isProcessMessage(message) || (
    message.kind === 'rework' &&
    message.authorId === 'you' &&
    humanContext.has(`${message.meta?.stage ?? ''}|${String(message.text ?? '').trim()}`)
  )
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
  const process = messages.filter(isProcess)
  const visible = messages.filter(message => (
    !isProcess(message) &&
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
