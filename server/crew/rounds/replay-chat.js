// 只读重放聊天室：把轮次事件和已经落库的消息按时间串起来，回答这一轮谁说了什么、结论从哪来。
// 只读；不重建也不改写状态。事件和消息的时间戳来自同一个进程时钟，可以按 at/ts 对窗。
const timeOf = value => {
  const at = Number(value?.at ?? value?.ts)
  return Number.isFinite(at) ? at : 0
}

// 结论消息单独放在 conclusion 里，不混进发言列表，避免同一段话显示两次。
const MESSAGE_KINDS = new Set(['chat', 'chat_rework'])
const NOTE_WINDOW_MS = 5_000

export const replayChat = ({ events = [], messages = [], members = [] } = {}) => {
  const eventList = Array.isArray(events) ? [...events] : []
  const messageList = Array.isArray(messages) ? [...messages] : []
  const warnings = []
  if (eventList.length === 0) warnings.push('没有找到聊天事件')

  const names = new Map(
    (Array.isArray(members) ? members : [])
      .filter(member => typeof member?.id === 'string' && member.id !== '')
      .map(member => [member.id, String(member.name ?? member.id)]),
  )
  const nameOf = id => {
    if (id === 'you') return '你'
    if (id === 'lodge' || id === 'host') return '主持'
    if (id === 'system') return '房间'
    return names.get(id) ?? String(id ?? '')
  }

  const rounds = []
  const byRound = new Map()
  const ensure = (round, at) => {
    if (!Number.isInteger(round) || round <= 0) return null
    if (!byRound.has(round)) {
      const entry = {
        round,
        startedAt: at,
        endedAt: null,
        continued: false,
        continuedFrom: null,
        resumes: 0,
        restarted: false,
        summaryStarted: false,
        speakers: [],
        conclusionEvent: null,
        conclusion: null,
        note: '',
        messages: [],
        warnings: [],
      }
      byRound.set(round, entry)
      rounds.push(entry)
    }
    return byRound.get(round)
  }

  eventList.sort((left, right) => timeOf(left) - timeOf(right))
  let current = null
  for (const event of eventList) {
    const at = timeOf(event)
    const payload = event?.payload ?? {}
    if (event?.type === 'chat.continued') {
      const entry = ensure(payload.round, at)
      if (entry === null) continue
      entry.continued = true
      entry.continuedFrom = payload.round - 1
      entry.startedAt = Math.min(entry.startedAt, at)
      current = entry
      continue
    }
    if (event?.type === 'chat.round_started') {
      const entry = ensure(payload.round, at)
      if (entry === null) continue
      if (current === entry && entry.speakers.length > 0) entry.restarted = true
      entry.startedAt = Math.min(entry.startedAt, at)
      current = entry
      continue
    }
    if (event?.type === 'chat.round_resumed' || event?.type === 'chat.resumed') {
      const entry = ensure(payload.round, at)
      if (entry === null) continue
      entry.resumes += 1
      if (event.type === 'chat.resumed') entry.restarted = true
      current = entry
      continue
    }
    if (event?.type === 'chat.speaker') {
      if (current === null || typeof payload.memberId !== 'string' || payload.memberId === '') continue
      current.speakers.push({
        memberId: payload.memberId,
        name: nameOf(payload.memberId),
        turn: payload.turn ?? null,
        at,
        spoke: false,
      })
      continue
    }
    if (event?.type === 'chat.summary_started') {
      if (current !== null) current.summaryStarted = true
      continue
    }
    if (event?.type === 'chat.conclusion') {
      const entry = ensure(payload.round, at) ?? current
      if (entry === null) continue
      entry.conclusionEvent = { at, fallback: payload.fallback === true }
      entry.endedAt = at
      current = entry
    }
  }

  // 「再讨论一轮」的备注消息先落库、再发 continued 事件；把它归到接着开始的那一轮。
  const notes = messageList
    .filter(message => message?.kind === 'chat_rework')
    .sort((left, right) => timeOf(left) - timeOf(right))
  const taken = new Set()
  for (const entry of rounds) {
    if (!entry.continued) continue
    const note = [...notes].reverse().find(message => (
      !taken.has(message) &&
      timeOf(message) <= entry.startedAt &&
      entry.startedAt - timeOf(message) <= NOTE_WINDOW_MS
    ))
    if (note === undefined) continue
    taken.add(note)
    entry.note = String(note.text ?? '')
  }

  const ordered = [...rounds].sort((left, right) => left.round - right.round)
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]
    const next = ordered[index + 1]
    const endAt = entry.conclusionEvent?.at ?? (next === undefined ? Infinity : next.startedAt)
    const endInclusive = entry.conclusionEvent !== null
    const inside = message => {
      if (!MESSAGE_KINDS.has(message?.kind) || taken.has(message)) return false
      const at = timeOf(message)
      if (at < entry.startedAt) return false
      return endInclusive ? at <= endAt : at < endAt
    }
    entry.messages = messageList
      .filter(inside)
      .sort((left, right) => timeOf(left) - timeOf(right))
      .map(message => ({
        seq: message.seq ?? null,
        authorId: message.authorId ?? '',
        name: nameOf(message.authorId),
        kind: message.kind,
        text: String(message.text ?? ''),
        at: timeOf(message),
      }))

    // 结论消息在结论事件之前落库；优先按 meta.round 认领，旧消息没有轮次就按时间窗兜底。
    const finalMessage = messageList
      .filter(message => message?.kind === 'chat_conclusion' && (
        Number.isInteger(message.meta?.round)
          ? message.meta.round === entry.round
          : timeOf(message) >= entry.startedAt && timeOf(message) <= endAt
      ))
      .sort((left, right) => timeOf(left) - timeOf(right))
      .at(-1)
    if (finalMessage !== undefined) {
      entry.conclusion = {
        text: String(finalMessage.text ?? ''),
        at: timeOf(finalMessage),
        fallback: finalMessage.meta?.fallback === true || entry.conclusionEvent?.fallback === true,
        handoff: finalMessage.meta?.handoff ?? null,
      }
    }

    if (entry.speakers.length === 0) entry.warnings.push('这一轮没有记录到发言安排')
    for (const speaker of entry.speakers) {
      speaker.spoke = entry.messages.some(message => message.kind === 'chat' && message.authorId === speaker.memberId)
      if (!speaker.spoke) entry.warnings.push(`${speaker.name} 没有留下发言`)
    }
    if (entry.conclusionEvent !== null && entry.conclusion === null) {
      entry.warnings.push('有结论事件，但没有找到结论消息')
    }
    if (entry.conclusion !== null && !entry.summaryStarted) {
      entry.warnings.push('结论前没有记录到总结阶段')
    }
    if (entry.conclusion === null) entry.warnings.push('这一轮还没有结论')
    if (entry.conclusion?.fallback === true) {
      entry.warnings.push('结论是自动摘要：主持没有在时限内回应')
    }
  }

  if (ordered.length === 0) warnings.push('没有找到聊天轮次')
  return { rounds: ordered, warnings }
}
