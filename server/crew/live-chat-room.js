import { INTERNAL_PROMPT_MARKER } from './internal-prompts.js'
import { chatTransitionEvent, transitionChat } from './room-state.js'
import { seatDisplayName } from './seat-labels.js'

export const CHAT_TURNS_PER_ROUND = 6
export const MAX_CHAT_TURNS_PER_ROUND = 20

// 轮次上限是房间参数，不是引擎常量；默认 6，建房时可配置。
export const chatTurnLimitOf = room => {
  const value = Number(room?.chat?.turnLimit)
  return Number.isInteger(value) && value >= 1 && value <= MAX_CHAT_TURNS_PER_ROUND
    ? value
    : CHAT_TURNS_PER_ROUND
}

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

const speakerPrompt = ({ room, seat, round, turn, turnLimit, note, lines }) => {
  return [
    `@${baseName(room, seat)} 聊天室话题：${room.goal}`,
    `讨论进行到第 ${round} 轮，第 ${turn}/${turnLimit} 次发言。`,
    note === '' ? '' : `你上一轮退回了结论，并补充：${note}`,
    lines.length === 0 ? '还没有人发言。' : `已有讨论：\n${lines.join('\n')}`,
    '请只补充你的观点、依据或质疑；不要重复别人，不要调用工具。直接回复你的发言。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

const hostPrompt = ({ room, hostName, round, note, lines }) => [
  `@${hostName} 聊天室第 ${round} 轮讨论到此结束，请总结。`,
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
    // 新聊天室由 Lodge 主持：主持模型是隐藏成员，不占三个发言席位。
    const hostSeat = typeof room.leadSeat === 'string' ? room.leadSeat : null
    const hostBot = room.chatHost?.memberRef ?? (hostSeat === null ? '' : room.seatBots?.[hostSeat] ?? '')
    const hostName = room.chatHost?.name ?? (hostSeat === null ? 'Lodge 主持' : baseName(room, hostSeat))
    const hostAuthor = room.chatHost === undefined || room.chatHost === null ? hostSeat ?? 'lodge' : 'lodge'
    if (hostBot === '') throw new Error('聊天室没有主持席位')
    const speakers = room.chatHost === undefined || room.chatHost === null
      ? (room.members ?? []).filter(seat => seat !== hostSeat)
      : [...(room.members ?? [])]
    const turnLimit = chatTurnLimitOf(room)
    const perSeat = speakers.length === 0
      ? turnLimit
      : Math.max(1, Math.ceil(turnLimit / speakers.length))
    const run = { cancelled: false }
    runs.set(roomId, run)
    const round = Number.isInteger(room.chat?.round) && room.chat.round > 0 ? room.chat.round : 1
    const counts = new Map()
    let last = null
    let completed = 0

    patch(current => {
      current.chat = {
        ...(current.chat ?? {}),
        round,
        phase: 'discussing',
        turns: 0,
        conclusionId: null,
        accepted: false,
        running: true,
        speaker: '',
        note,
      }
      return { events: [{ type: 'chat.round_started', payload: { round } }] }
    })

    try {
      if (speakers.length > 0) {
        await waitIdle(chat.id, run)
        for (let turn = 1; turn <= turnLimit; turn += 1) {
          const current = store.readRoom(roomId)
          if (run.cancelled || current === null || current.state !== 'active') break
          const seat = pickChatSpeaker({ speakers, counts, perSeat, last, random })
          if (seat === null) break
          room = current
          counts.set(seat, (counts.get(seat) ?? 0) + 1)
          last = seat
          if (turn === 1) {
            const text = `本轮围绕「${room.goal}」展开讨论。${seatDisplayName(room, seat)} 先发言。`
            store.appendMessage(roomId, room.chatHost === undefined || room.chatHost === null
              ? { kind: 'chat', authorId: hostSeat, text, meta: { opening: true, round } }
              : { kind: 'system', text: `Lodge 主持：${text}`, meta: { opening: true, round } })
          }
          const before = await messageIds(chat)
          const text = speakerPrompt({
            room,
            seat,
            round,
            turn,
            turnLimit,
            note,
            lines: discussionLines(store, roomId),
          })
          const sent = await engine.sendTurn({ roomId: chat.id, text })
          hidePrompt(sent?.messageId)
          patch(state => {
            state.chat = {
              ...state.chat,
              phase: 'discussing',
              turns: turn,
              speaker: seat,
              running: true,
            }
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
            state.chat = {
              ...state.chat,
              phase: 'discussing',
              turns: completed,
              speaker: '',
              running: true,
            }
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
      const summarizing = transitionChat(store.readRoom(roomId)?.chat?.phase ?? 'discussing', 'summarize')
      if (!summarizing.ok) throw new Error(summarizing.error)
      patch(state => {
        state.chat = {
          ...state.chat,
          phase: summarizing.state,
          speaker: hostAuthor,
          running: true,
        }
        return { events: [{ type: 'chat.summary_started', payload: { round } }, chatTransitionEvent(summarizing, 'summarize', hostAuthor, '达到发言上限')] }
      })
      let before = await messageIds(chat)
      let sent = await engine.sendTurn({
        roomId: chat.id,
        text: hostPrompt({ room: store.readRoom(roomId) ?? room, hostName, round, note, lines }),
      })
      hidePrompt(sent?.messageId)
      let reply = await waitForBot(chat, hostBot, before, run)
      if (reply === null && !run.cancelled) {
        await waitIdle(chat.id, run, 30_000)
        before = await messageIds(chat)
        sent = await engine.sendTurn({
          roomId: chat.id,
          text: hostPrompt({ room: store.readRoom(roomId) ?? room, hostName, round, note, lines }),
        })
        hidePrompt(sent?.messageId)
        reply = await waitForBot(chat, hostBot, before, run)
      }
      if (run.cancelled) return { started: true, cancelled: true, round }

      const fallback = reply === null
      const text = !fallback
        ? (reply.turn?.reply ?? reply.text ?? '')
        : digestText(lines)
      const conclusion = store.appendMessage(roomId, {
        kind: 'chat_conclusion',
        authorId: hostAuthor,
        text: text === '' ? digestText(lines) : text,
        meta: {
          round,
          turnLimit,
          turns: completed,
          host: hostAuthor,
          fallback: fallback || text === '',
          at: Date.now(),
        },
      })
      const concluded = transitionChat('summarizing', 'conclude')
      if (!concluded.ok) throw new Error(concluded.error)
      const updated = patch(current => {
        current.chat = {
          ...current.chat,
          phase: concluded.state,
          turns: completed,
          conclusionId: conclusion?.id ?? null,
          accepted: false,
          running: false,
          speaker: '',
        }
        return { events: [{ type: 'chat.conclusion', payload: { round, fallback } }, chatTransitionEvent(concluded, 'conclude', hostAuthor, '主持人总结完成')] }
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
      if (current?.chat?.running === true) {
        patch(state => {
          const rolled = transitionChat(state.chat.phase ?? 'discussing', 'abort')
          state.chat = {
            ...state.chat,
            running: false,
            speaker: '',
            ...(rolled.ok ? { phase: rolled.state } : {}),
          }
          return { events: rolled.ok ? [chatTransitionEvent(rolled, 'abort', 'system', '聊天调度中止')] : [] }
        })
      }
      void refresh()
    }
  }

  return { start, cancel, isRunning: () => runs.has(roomId) }
}
