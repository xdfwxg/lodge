import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
import { seatDisplayName } from './seat-labels.js'

export const CHAT_TURNS_PER_ROUND = 6
const DEFAULT_WAIT_MS = 120_000
const POLL_MS = 750

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const truncate = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

export const pickChatSpeaker = ({ speakers, counts, perSeat, last, random = Math.random }) => {
  if (speakers.length === 0) return null
  const eligible = speakers.filter(seat => (counts.get(seat) ?? 0) < perSeat)
  const pool = eligible.length === 0 ? speakers : eligible
  const unspoken = pool.filter(seat => (counts.get(seat) ?? 0) === 0)
  const candidates = unspoken.length > 0 ? unspoken : pool.filter(seat => seat !== last)
  const final = candidates.length > 0 ? candidates : pool
  return final[Math.min(final.length - 1, Math.floor(random() * final.length))] ?? null
}

const discussionLines = (store, roomId, limit = 12) => store.readMessages(roomId)
  .filter(message => message.kind === 'chat' || message.kind === 'chat_rework')
  .slice(-limit)
  .map(message => {
    const name = message.authorId === 'you'
      ? '你'
      : (message.authorId === 'system' ? '系统' : (store.readRoom(roomId)?.seatNames?.[message.authorId] ?? message.authorId))
    return `${name}：${truncate(message.text, 500)}`
  })

const baseName = (room, seat) => room?.seatNames?.[seat] ?? seatDisplayName(room, seat)

const speakerPrompt = ({ room, seat, round, turn, note, lines }) => {
  return [
    `@${baseName(room, seat)} 聊天室话题：${room.goal}`,
    `讨论进行到第 ${round} 轮，第 ${turn}/${CHAT_TURNS_PER_ROUND} 次发言。`,
    note === '' ? '' : `你上一轮退回了结论，并补充：${note}`,
    lines.length === 0 ? '还没有人发言。' : `已有讨论：\n${lines.join('\n')}`,
    '请只补充你的观点、依据或质疑；不要重复别人，不要调用工具。直接回复你的发言。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

const hostPrompt = ({ room, round, note, lines }) => [
  `@${baseName(room, room.leadSeat)} 聊天室第 ${round} 轮讨论到此结束，请总结。`,
  `话题：${room.goal}`,
  note === '' ? '' : `用户退回了上一轮结论，并补充：${note}`,
  lines.length === 0 ? '没有讨论内容。' : `讨论记录：\n${lines.join('\n')}`,
  '请给出：结论、主要分歧、建议下一步。不要调用工具。直接回复总结。',
  INTERNAL_PROMPT_MARKER,
].filter(Boolean).join('\n')

const digestText = lines => lines.length === 0
  ? '讨论没有产生可总结的内容。'
  : `主持人未能在限定时间内总结。以下是本轮讨论记录：\n\n${lines.join('\n')}`

export const createChatScheduler = ({
  store,
  engine,
  roomId,
  emit = () => {},
  refresh = () => {},
  random = Math.random,
  waitMs = DEFAULT_WAIT_MS,
  pollMs = POLL_MS,
}) => {
  const runs = new Map()

  const patch = mutate => {
    const updated = store.updateRoom(roomId, mutate)
    if (updated !== null) emit('room', updated)
    return updated
  }

  const hidePrompt = messageId => {
    if (typeof messageId !== 'string' || messageId === '') return
    store.updateRoom(roomId, current => {
      current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), messageId].slice(-80)
      return { events: [] }
    })
  }

  const messageIds = async chat => {
    const { messages } = await engine.history(chat.sessionRef, { limit: 200 })
    return new Set(messages.map(message => message.id))
  }

  const waitForBot = async (chat, memberRef, before, run) => {
    if (typeof memberRef !== 'string' || memberRef === '') return null
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (run.cancelled) return null
      try {
        const { messages } = await engine.history(chat.sessionRef, { limit: 200 })
        const hit = messages.find(message => (
          !before.has(message.id) &&
          message.authorRef === memberRef &&
          (message.kind === 'text' || (message.kind === 'turn' && message.turn?.reply))
        ))
        if (hit !== undefined) return hit
      } catch {
        // 基座短暂不可用不等于发言失败；继续在窗口内轮询。
      }
      await sleep(pollMs)
    }
    return null
  }

  const waitIdle = async (chatId, run, timeout = 60_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (run.cancelled) return false
      try {
        const room = (await engine.rooms()).find(item => item.id === chatId)
        if (room === undefined || room.working !== true) return true
      } catch {
        return true
      }
      await sleep(pollMs)
    }
    return false
  }

  const cancel = () => {
    const run = runs.get(roomId)
    if (run === undefined) return false
    run.cancelled = true
    return true
  }

  const start = async (inputRoom, { note = '' } = {}) => {
    if (runs.has(roomId)) return { started: false, reason: '聊天讨论已经在进行' }
    let room = store.readRoom(roomId) ?? inputRoom
    const chat = room?.chatRoom
    if (chat === undefined) throw new Error('房间聊天室还没准备好')
    const host = room.leadSeat ?? room.members?.[0]
    if (typeof host !== 'string' || host === '') throw new Error('聊天室没有主持席位')
    const speakers = (room.members ?? []).filter(seat => seat !== host)
    const perSeat = speakers.length === 0
      ? CHAT_TURNS_PER_ROUND
      : Math.max(1, Math.ceil(CHAT_TURNS_PER_ROUND / speakers.length))
    const run = { cancelled: false }
    runs.set(roomId, run)
    const round = Number.isInteger(room.chatRound) && room.chatRound > 0 ? room.chatRound : 1
    const counts = new Map()
    let last = null
    let completed = 0

    patch(current => {
      current.chatRunning = true
      current.chatRound = round
      current.chatTurns = 0
      current.chatSpeaker = ''
      current.chatPhase = ''
      current.chatNote = note
      return { events: [{ type: 'chat.round_started', payload: { round } }] }
    })

    try {
      if (speakers.length > 0) {
        await waitIdle(chat.id, run)
        for (let turn = 1; turn <= CHAT_TURNS_PER_ROUND; turn += 1) {
          const current = store.readRoom(roomId)
          if (run.cancelled || current === null || current.state !== 'active') break
          const seat = pickChatSpeaker({ speakers, counts, perSeat, last, random })
          if (seat === null) break
          room = current
          counts.set(seat, (counts.get(seat) ?? 0) + 1)
          last = seat
          const before = await messageIds(chat)
          const text = speakerPrompt({
            room,
            seat,
            round,
            turn,
            note,
            lines: discussionLines(store, roomId),
          })
          const sent = await engine.sendTurn({ roomId: chat.id, text })
          hidePrompt(sent?.messageId)
          patch(state => {
            state.chatTurns = turn
            state.chatSpeaker = seat
            state.chatPhase = 'speaking'
            return { events: [{ type: 'chat.speaker', payload: { seat, turn } }] }
          })
          const reply = await waitForBot(chat, room.seatBots?.[seat], before, run)
          if (run.cancelled) break
          if (reply === null) {
            store.appendMessage(roomId, {
              kind: 'system',
              text: `${seatDisplayName(room, seat)} 没有在限定时间内回应；继续下一位。`,
            })
          }
          completed = turn
          patch(state => {
            state.chatTurns = completed
            state.chatSpeaker = ''
            state.chatPhase = ''
            return { events: [] }
          })
          await waitIdle(chat.id, run)
        }
      }

      if (run.cancelled) return { started: true, cancelled: true, round }
      const beforeSummary = store.readRoom(roomId)
      if (beforeSummary === null || beforeSummary.state !== 'active') {
        return { started: true, cancelled: true, round }
      }

      const lines = discussionLines(store, roomId, 16)
      patch(state => {
        state.chatSpeaker = host
        state.chatPhase = 'summarizing'
        return { events: [{ type: 'chat.summary_started', payload: { round } }] }
      })
      let before = await messageIds(chat)
      let sent = await engine.sendTurn({
        roomId: chat.id,
        text: hostPrompt({ room: store.readRoom(roomId) ?? room, round, note, lines }),
      })
      hidePrompt(sent?.messageId)
      let reply = await waitForBot(chat, room.seatBots?.[host], before, run)
      if (reply === null && !run.cancelled) {
        await waitIdle(chat.id, run, 30_000)
        before = await messageIds(chat)
        sent = await engine.sendTurn({
          roomId: chat.id,
          text: hostPrompt({ room: store.readRoom(roomId) ?? room, round, note, lines }),
        })
        hidePrompt(sent?.messageId)
        reply = await waitForBot(chat, room.seatBots?.[host], before, run)
      }
      if (run.cancelled) return { started: true, cancelled: true, round }

      const fallback = reply === null
      const text = !fallback
        ? (reply.turn?.reply ?? reply.text ?? '')
        : digestText(lines)
      const updated = patch(current => {
        current.chatRunning = false
        current.chatSpeaker = ''
        current.chatPhase = ''
        current.chatTurns = completed
        const discussion = current.stages?.[0]
        if (discussion !== undefined) discussion.state = 'passed'
        const conclusion = current.stages?.[1]
        if (conclusion !== undefined) conclusion.state = 'active'
        return { events: [{ type: 'chat.conclusion', payload: { round, fallback } }] }
      })
      store.appendMessage(roomId, {
        kind: 'chat_conclusion',
        authorId: host,
        text: text === '' ? digestText(lines) : text,
        meta: {
          round,
          turns: completed,
          host,
          fallback: fallback || text === '',
          at: Date.now(),
        },
      })
      if (updated !== null) emit('room', store.readRoom(roomId) ?? updated)
      void refresh()
      return { started: true, round, turns: completed, fallback }
    } catch (error) {
      store.appendMessage(roomId, { kind: 'system', text: `聊天调度失败：${error?.message ?? error}` })
      return { started: true, error: String(error?.message ?? error) }
    } finally {
      runs.delete(roomId)
      const current = store.readRoom(roomId)
      if (current?.chatRunning === true) {
        patch(state => {
          state.chatRunning = false
          state.chatSpeaker = ''
          state.chatPhase = ''
          return { events: [] }
        })
      }
      void refresh()
    }
  }

  return { start, cancel, isRunning: () => runs.has(roomId) }
}
