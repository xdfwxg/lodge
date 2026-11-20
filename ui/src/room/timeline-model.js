import { humanNoteKeys, isDuplicateHumanRework } from './human-note.js'

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

const speechText = text => String(text ?? '').replace(/\s+/g, ' ').trim()

// 同一位成员的话可能从群聊和成员线程各来一份，其中一份会被截断；两分钟内留更完整的那份。
const sameSpeech = (a, b) => {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  return short.length >= 40 && long.startsWith(short)
}

export const dedupeChatCopies = messages => {
  const kept = []
  for (const message of messages) {
    if (message.kind !== 'chat' || message.authorId === 'you') {
      kept.push(message)
      continue
    }
    const text = speechText(message.text)
    const at = typeof message.ts === 'number' ? message.ts : 0
    const twinIndex = kept.findIndex(item => (
      item.kind === 'chat' &&
      item.authorId === message.authorId &&
      typeof item.ts === 'number' &&
      Math.abs(item.ts - at) <= 120_000 &&
      sameSpeech(speechText(item.text), text)
    ))
    if (twinIndex < 0) {
      kept.push(message)
      continue
    }
    if (text.length > speechText(kept[twinIndex].text).length) kept[twinIndex] = message
  }
  return kept
}

export const buildTimeline = messages => {
  messages = dedupeChatCopies(dedupeChatStreams(messages))
  // 人的重做标记和 human-context 是同一条输入的两种记录；主时间线只留后者。
  const humanNotes = humanNoteKeys(messages)
  const isProcess = message => isProcessMessage(message) || isDuplicateHumanRework(message, humanNotes)
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
