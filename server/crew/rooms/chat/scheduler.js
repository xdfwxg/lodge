import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { chatTransitionEvent, transitionChat } from './state.js'
import { memberDisplayName } from '../../member-labels.js'
import { recentAndOlder } from '../../prompt-context.js'
import { turnLimitOf as chatTurnLimitOf } from '../../room-types/chat.js'
import { personalityTurnCue } from '../../../../shared/personalities.js'
import { parseHandoffFromText } from '../../../../shared/handoff.js'

const DEFAULT_WAIT_MS = 120_000
const POLL_MS = 750
const MAX_MISSES = 3

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const truncate = (text, limit) => {
  const value = String(text ?? '').trim()
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

export const pickChatSpeaker = ({ speakers, counts, perMember, last, random = Math.random }) => {
  if (speakers.length === 0) return null
  const eligible = speakers.filter(memberId => (counts.get(memberId) ?? 0) < perMember)
  const pool = eligible.length === 0 ? speakers : eligible
  const unspoken = pool.filter(memberId => (counts.get(memberId) ?? 0) === 0)
  const candidates = unspoken.length > 0 ? unspoken : pool.filter(memberId => memberId !== last)
  const final = candidates.length > 0 ? candidates : pool
  return final[Math.min(final.length - 1, Math.floor(random() * final.length))] ?? null
}

const discussionLines = (store, roomId) => {
  const room = store.readRoom(roomId)
  const messages = store.readMessages(roomId)
    .filter(message => message.kind === 'chat' || message.kind === 'chat_rework')
  const nameOf = message => message.authorId === 'you'
    ? '你'
    : message.authorId === 'system' ? '房间' : memberDisplayName(room, message.authorId)
  return recentAndOlder(messages, { nameOf })
}

const memberOf = (room, memberId) => (room?.members ?? []).find(member => member.id === memberId) ?? null

// 群聊本身已有讨论记录；提示词只放当前动作，不重复整段历史。
const speakerPrompt = ({ room, memberId, round, turn, turnLimit, note }) => {
  const personality = memberOf(room, memberId)?.personality
  return [
    `@${memberDisplayName(room, memberId)} 聊天室话题：${room.goal}`,
    `第 ${round} 轮，第 ${turn}/${turnLimit} 次发言。`,
    note === '' ? '' : `你上一轮退回了结论，并补充：${note}`,
    '请给出你的观点、依据或质疑；不要重复别人，不要调用工具。直接回复发言。',
    `本轮表达：${personalityTurnCue(personality)}`,
    '每次发言控制在 200 字以内；不要写总结。',
    INTERNAL_PROMPT_MARKER,
  ].filter(Boolean).join('\n')
}

const hostPrompt = ({ room, round, note }) => [
  `聊天室第 ${round} 轮讨论到此结束，请总结。`,
  `话题：${room.goal}`,
  note === '' ? '' : `用户退回了上一轮结论，并补充：${note}`,
  '只写本轮结论，不要寒暄，不要逐条复述发言，不要调用工具。严格按下面五段输出，标题固定：',
  '## 主题',
  '一句话说清这轮在解决什么。',
  '## 共识',
  '- 已达成的结论，最多 5 条',
  '## 分歧',
  '- 未解决的分歧，最多 5 条；没有写「无」',
  '## 约束',
  '- 前提、限制、风险，最多 5 条；没有写「无」',
  '## 待办',
  '- 下一步要做什么，最多 5 条；没有写「无」',
  '每段不超过 100 字，总长不超过 800 字。',
  INTERNAL_PROMPT_MARKER,
].filter(Boolean).join('\n')

const digestText = lines => lines.length === 0
  ? '讨论没有产生可总结的内容。'
  : `主持人未能在限定时间内总结。以下是本轮讨论记录：\n\n${lines.join('\n')}`

export const createChatScheduler = ({
  store,
  engine,
  sendToMember,
  roomId,
  emit = () => {},
  refresh = () => {},
  random = Math.random,
  waitMs = DEFAULT_WAIT_MS,
  pollMs = POLL_MS,
  syncChat = async () => {},
  idleMs = 60_000,
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
    const { messages } = await engine.history(chat.sessionRef, { limit: 1000 })
    return new Set(messages.map(message => message.id))
  }

  const waitForBot = async (chat, memberRef, before, run) => {
    if (typeof memberRef !== 'string' || memberRef === '') return null
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (run.cancelled) return null
      try {
        const { messages } = await engine.history(chat.sessionRef, { limit: 1000 })
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
    // 主持人是 Lodge 自己的隐藏成员，不占发言位置。
    const hostBot = room.chatHost?.memberRef ?? ''
    const hostName = room.chatHost?.name ?? ''
    const hostAuthor = 'lodge'
    if (hostBot === '' || hostName === '') throw new Error('聊天室没有主持人')
    const speakers = (room.members ?? []).map(member => member.id)
    const turnLimit = chatTurnLimitOf(room)
    const perMember = speakers.length === 0
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
        const idle = await waitIdle(chat.id, run, idleMs)
        if (!idle) store.appendMessage(roomId, { kind: 'system', text: '基座一直忙，本轮不再继续派发言。' })
        if (idle) {
        let misses = 0
        for (let turn = 1; turn <= turnLimit; turn += 1) {
          const current = store.readRoom(roomId)
          if (run.cancelled || current === null || current.state !== 'active') break
          const memberId = pickChatSpeaker({ speakers, counts, perMember, last, random })
          if (memberId === null) break
          room = current
          counts.set(memberId, (counts.get(memberId) ?? 0) + 1)
          last = memberId
          if (turn === 1) {
            const text = `本轮围绕【${room.goal}】展开讨论。`
            store.appendMessage(roomId, { kind: 'chat', authorId: 'lodge', text, meta: { opening: true, round } })
          }
          const before = await messageIds(chat)
          const text = speakerPrompt({
            room,
            memberId,
            round,
            turn,
            turnLimit,
            note,
          })
          const sent = await sendToMember(memberId, text)
          hidePrompt(sent?.messageId)
          patch(state => {
            state.chat = {
              ...state.chat,
              phase: 'discussing',
              turns: turn,
              speaker: memberId,
              running: true,
            }
            return { events: [{ type: 'chat.speaker', payload: { memberId, turn } }] }
          })
          const reply = await waitForBot(chat, memberOf(room, memberId)?.body?.ref, before, run)
          if (run.cancelled) break
          if (reply === null) {
            misses += 1
            store.appendMessage(roomId, {
              kind: 'system',
              text: `${memberDisplayName(room, memberId)} 没有在限定时间内回应${misses >= MAX_MISSES ? '；本轮提前收尾' : '；继续下一位'}。`,
            })
            if (misses >= MAX_MISSES) break
          } else {
            misses = 0
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
          if (!(await waitIdle(chat.id, run, idleMs))) {
            store.appendMessage(roomId, { kind: 'system', text: '基座一直忙，本轮不再继续派发言。' })
            break
          }
        }
        }
      }

      if (run.cancelled) return { started: true, cancelled: true, round }
      const beforeSummary = store.readRoom(roomId)
      if (beforeSummary === null || beforeSummary.state !== 'active') {
        return { started: true, cancelled: true, round }
      }

      // 基座事件可能晚于发言轮次到达；总结前强制同步一次，迟到的发言也会落在结论之前。
      try {
        await syncChat()
      } catch {
        // 同步失败不阻塞总结；房间已有消息仍可总结。
      }
      const lines = discussionLines(store, roomId)
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
      let sent = await sendToMember('host', hostPrompt({ room: store.readRoom(roomId) ?? room, round, note }))
      hidePrompt(sent?.messageId)
      let reply = await waitForBot(chat, hostBot, before, run)
      if (reply === null && !run.cancelled) {
        await waitIdle(chat.id, run, Math.min(30_000, idleMs))
        before = await messageIds(chat)
        sent = await sendToMember('host', hostPrompt({ room: store.readRoom(roomId) ?? room, round, note }))
        hidePrompt(sent?.messageId)
        reply = await waitForBot(chat, hostBot, before, run)
      }
      if (run.cancelled) return { started: true, cancelled: true, round }

      const fallback = reply === null
      const text = !fallback
        ? (reply.turn?.reply ?? reply.text ?? '')
        : digestText(lines)
      const conclusionText = text === '' ? digestText(lines) : text
      const handoff = parseHandoffFromText(conclusionText, store.readRoom(roomId)?.goal ?? room.goal)
      const conclusion = store.appendMessage(roomId, {
        kind: 'chat_conclusion',
        authorId: hostAuthor,
        text: conclusionText,
        meta: {
          round,
          turnLimit,
          turns: completed,
          host: hostAuthor,
          fallback: fallback || text === '',
          at: Date.now(),
          ...(handoff === null ? {} : { handoff }),
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
