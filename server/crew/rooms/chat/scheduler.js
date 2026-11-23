import { chatTransitionEvent, transitionChat } from './state.js'
import { memberDisplayName } from '../../member-labels.js'
import { memberOf } from '../../room-members.js'
import { recentAndOlder } from '../../prompt-context.js'
import { turnLimitOf as chatTurnLimitOf } from '../../room-types/chat.js'
import { parseHandoffFromText } from '../../../../shared/handoff.js'
import { finalizeHostIntent, hostIntentPrompt, parseHostIntent, roundVetoed } from './host-intent.js'
import { chatBriefOf } from './brief.js'
import { linkedRoomBriefs } from './linked.js'
import { digestText, hostPrompt, speakerPrompt, wantsStructuredSummary } from './prompts.js'
import { systemNotice } from '../../notices.js'
import { humanLabelOf } from '../../human-name.js'
import { CHAT_PHASE, ROOM_STATE } from '../../../../shared/states.js'

const DEFAULT_WAIT_MS = 120_000
const POLL_MS = 750
const MAX_MISSES = 3

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const STANCE_NEXT = Object.freeze({
  proposer: 'critic',
  critic: 'synthesizer',
  synthesizer: 'proposer',
})

export const pickChatSpeaker = ({
  speakers,
  counts,
  perMember,
  last,
  stanceOf = () => '',
  random = Math.random,
}) => {
  if (speakers.length === 0) return null
  const eligible = speakers.filter(memberId => (counts.get(memberId) ?? 0) < perMember)
  const pool = eligible.length === 0 ? speakers : eligible
  const unspoken = pool.filter(memberId => (counts.get(memberId) ?? 0) === 0)
  const candidates = unspoken.length > 0 ? unspoken : pool.filter(memberId => memberId !== last)
  const final = candidates.length > 0 ? candidates : pool
  // 先保证每人开口，再让 proposer → critic → synthesizer 互补；没有合适立场才随机。
  const preferred = STANCE_NEXT[stanceOf(last)] ?? ''
  const complementary = preferred === ''
    ? []
    : final.filter(memberId => stanceOf(memberId) === preferred)
  const choice = complementary.length > 0 ? complementary : final
  return choice[Math.min(choice.length - 1, Math.floor(random() * choice.length))] ?? null
}

// 续跑时从本轮开场后的发言补回计数，保证重启不会打破“每人先说到一次”的顺序。
const chatCountsForRound = (messages, round, speakers) => {
  const list = Array.isArray(messages) ? messages : []
  let start = -1
  for (let index = list.length - 1; index >= 0; index -= 1) {
    const message = list[index]
    if (message?.kind === 'chat' && message?.meta?.opening === true && (message.meta.round ?? round) === round) {
      start = index
      break
    }
  }
  const counts = new Map()
  let last = null
  let lastText = ''
  for (const message of list.slice(start + 1)) {
    if (message?.kind !== 'chat' || !speakers.includes(message.authorId)) continue
    counts.set(message.authorId, (counts.get(message.authorId) ?? 0) + 1)
    last = message.authorId
    lastText = String(message.text ?? '')
  }
  return { counts, last, lastText }
}

const discussionLines = (store, roomId) => {
  const room = store.readRoom(roomId)
  const messages = store.readMessages(roomId)
    .filter(message => message.kind === 'chat' || message.kind === 'chat_rework')
  const nameOf = message => message.authorId === 'you'
    ? humanLabelOf('你')
    : message.authorId === 'system' ? '房间' : memberDisplayName(room, message.authorId)
  return recentAndOlder(messages, { nameOf })
}

export const createChatScheduler = ({
  store,
  transport,
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

  const waitForBot = async (memberId, before, run) => {
    const deadline = Date.now() + waitMs
    while (Date.now() < deadline) {
      if (run.cancelled) return null
      const hit = await transport.findReply(memberId, before)
      if (hit !== null) return hit
      await sleep(pollMs)
    }
    return null
  }

  const waitIdle = async (run, timeout = 60_000) => {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (run.cancelled) return false
      if (await transport.isIdle()) return true
      await sleep(pollMs)
    }
    return false
  }

  const cancel = () => {
    const room = store.readRoom(roomId)
    const round = Number(room?.chat?.round) || 1
    store.cancelWork?.(`chat-run:${roomId}:${round}`)
    const run = runs.get(roomId)
    if (run === undefined) return false
    run.cancelled = true
    return true
  }

  const start = async (inputRoom, { note = '', speakerIds = null, resume = false } = {}) => {
    if (runs.has(roomId)) return { started: false, reason: '聊天讨论已经在进行' }
    let room = store.readRoom(roomId) ?? inputRoom
    if (transport.ready() !== true) throw new Error('房间聊天室还没准备好')
    // 主持人是 Lodge 自己的隐藏成员，不占发言位置。成员和轮数都是房间固定配置。
    const hostAuthor = 'lodge'
    const allowedSpeakers = (room.members ?? []).map(member => member.id)
    const selected = Array.isArray(speakerIds)
      ? [...new Set(speakerIds.filter(id => allowedSpeakers.includes(id)))].slice(0, 3)
      : []
    const speakers = selected.length > 0 ? selected : allowedSpeakers
    const turnLimit = chatTurnLimitOf(room)
    const perMember = speakers.length === 0
      ? turnLimit
      : Math.max(1, Math.ceil(turnLimit / speakers.length))
    const run = { cancelled: false }
    runs.set(roomId, run)
    const round = Number.isInteger(room.chat?.round) && room.chat.round > 0 ? room.chat.round : 1
    const counts = new Map()
    // 重启后续跑：从已经落库的发言次数接着走，不从第一句重来。
    const resumedFrom = resume ? Math.min(turnLimit, Math.max(0, Number(room.chat?.turns) || 0)) : 0
    const seeded = resume ? chatCountsForRound(store.readMessages(roomId), round, speakers) : null
    if (seeded !== null) for (const [memberId, count] of seeded.counts) counts.set(memberId, count)
    // 上一轮的结论是这一轮共同知道的东西；刚开场还没有上一位。
    const brief = chatBriefOf(store.readMessages(roomId), { round })
    let previous = seeded !== null && typeof seeded.last === 'string' && seeded.last !== ''
      ? { name: memberDisplayName(room, seeded.last), text: seeded.lastText }
      : null
    let completed = resumedFrom
    // 发送前落盘的 pending 标记：回复已到但 turns 没来得及写时，重启用它补账。
    const markerOf = value => (
      value !== null && value !== undefined &&
      Number.isInteger(value.turn) &&
      typeof value.memberId === 'string' && value.memberId !== '' &&
      Array.isArray(value.beforeIds)
        ? value
        : null
    )
    let resumeMarker = resume ? markerOf(room.chat?.pending) : null
    if (resumeMarker !== null && (resumeMarker.turn !== resumedFrom + 1 || !speakers.includes(resumeMarker.memberId))) {
      resumeMarker = null
    }
    const runItemId = `chat-run:${roomId}:${round}`
    // 这一轮跑着的时候占住一条持久工作项；进程没了，重启后它会回到队列并续跑。
    store.enqueueWork?.({ id: runItemId, roomId, kind: 'chat.round', payload: { round }, availableAt: 0 })

    patch(current => {
      current.chat = {
        ...(current.chat ?? {}),
        round,
        phase: CHAT_PHASE.discussing,
        turns: resumedFrom,
        conclusionId: null,
        running: true,
        speaker: '',
        // 不合法或不属于这一轮的 pending 在这里清掉，别把旧标记带进新一轮。
        pending: resumeMarker === null ? null : (current.chat?.pending ?? null),
        note,
      }
      return { events: [{ type: resume ? 'chat.round_resumed' : 'chat.round_started', payload: { round, from: resumedFrom } }] }
    })

    try {
      if (speakers.length > 0) {
        const idle = await waitIdle(run, idleMs)
        if (!idle) store.appendMessage(roomId, { kind: 'system', text: 'Lodge 服务一直忙，这一轮先不再叫人发言。' })
        if (idle) {
        let misses = 0
        let last = seeded?.last ?? null
        for (let turn = resumedFrom + 1; turn <= turnLimit; turn += 1) {
          const current = store.readRoom(roomId)
          if (run.cancelled || current === null || current.state !== ROOM_STATE.active) break
          room = current
          if (turn === 1 && !resume) {
            const text = `【${room.goal}】`
            store.appendMessage(roomId, { kind: 'chat', authorId: 'lodge', text, meta: { opening: true, round } })
          }
          let memberId = null
          let before = null
          let resumed = false
          if (resumeMarker !== null) {
            // 重启时这一位已经发过话：只等已有回复，不再重发。
            resumed = true
            memberId = resumeMarker.memberId
            before = new Set(resumeMarker.beforeIds)
            resumeMarker = null
          } else {
            memberId = pickChatSpeaker({
              speakers,
              counts,
              perMember,
              last,
              stanceOf: id => memberOf(room, id)?.stance ?? '',
              random,
            })
            if (memberId === null) break
            before = await transport.messageIds()
            // 先落 pending，再发；进程死在等待回复中间也能靠它补账。
            patch(state => {
              state.chat = {
                ...state.chat,
                pending: {
                  turn,
                  memberId,
                  beforeIds: [...before].slice(-1000),
                  sentAt: Date.now(),
                },
              }
              return { events: [] }
            })
            const sent = await sendToMember(memberId, speakerPrompt({
              room,
              memberId,
              round,
              turn,
              turnLimit,
              note,
              brief,
              previous,
            }))
            hidePrompt(sent?.messageId)
          }
          counts.set(memberId, (counts.get(memberId) ?? 0) + 1)
          last = memberId
          patch(state => {
            state.chat = {
              ...state.chat,
              phase: CHAT_PHASE.discussing,
              // turns 只记“已经说完”的次数；正在说的这一位由 speaker 表示。
              turns: completed,
              speaker: memberId,
              running: true,
            }
            return { events: [{ type: 'chat.speaker', payload: { memberId, turn } }] }
          })
          const reply = await waitForBot(memberId, before, run)
          if (run.cancelled) break
          if (reply === null) {
            misses += 1
            patch(state => {
              state.chat = { ...state.chat, pending: null }
              return {
                events: resumed
                  ? [{ type: 'chat.turn_missed', payload: { turn, memberId, found: false } }]
                  : [],
              }
            })
            store.appendMessage(roomId, {
              kind: 'system',
              text: `${memberDisplayName(room, memberId)} 没有在限定时间内回应${misses >= MAX_MISSES ? '；本轮提前收尾' : '；继续下一位'}。`,
            })
            if (misses >= MAX_MISSES) break
            continue
          }
          misses = 0
          previous = { name: memberDisplayName(room, memberId), text: String(reply.text ?? '') }
          completed = turn
          patch(state => {
            state.chat = {
              ...state.chat,
              phase: CHAT_PHASE.discussing,
              turns: completed,
              speaker: '',
              running: true,
              pending: null,
            }
            return {
              events: resumed
                ? [{ type: 'chat.turn_recovered', payload: { turn, memberId, found: true } }]
                : [],
            }
          })
          if (!(await waitIdle(run, idleMs))) {
            store.appendMessage(roomId, { kind: 'system', text: 'Lodge 服务一直忙，这一轮先不再叫人发言。' })
            break
          }
       }
        }
      }

      if (run.cancelled) return { started: true, cancelled: true, round }
      const beforeSummary = store.readRoom(roomId)
      if (beforeSummary === null || beforeSummary.state !== ROOM_STATE.active) {
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
      let before = await transport.messageIds()
      const structuredSummary = wantsStructuredSummary(note)
      let sent = await sendToMember('host', hostPrompt({
        room: store.readRoom(roomId) ?? room,
        round,
        note,
        turnLimit,
        structured: structuredSummary,
      }))
      hidePrompt(sent?.messageId)
      let reply = await waitForBot('host', before, run)
      if (reply === null && !run.cancelled) {
        await waitIdle(run, Math.min(30_000, idleMs))
        before = await transport.messageIds()
        sent = await sendToMember('host', hostPrompt({
        room: store.readRoom(roomId) ?? room,
        round,
        note,
        turnLimit,
        structured: structuredSummary,
      }))
        hidePrompt(sent?.messageId)
        reply = await waitForBot('host', before, run)
      }
      if (run.cancelled) return { started: true, cancelled: true, round }

      const fallback = reply === null
      const text = !fallback
        ? (reply.text ?? '')
        : digestText(lines)
      const conclusionText = text === '' ? digestText(lines) : text
      const handoff = parseHandoffFromText(conclusionText, store.readRoom(roomId)?.goal ?? room.goal)
      // 自然总结只有「下一步」会被解析成 todo；正文仍要作为共识进工作室。
      if (!structuredSummary && handoff !== null && handoff.consensus.length === 0) {
        const body = conclusionText.replace(/\n?下一步[：:][\s\S]*$/, '').trim()
        if (body !== '') handoff.consensus = [body.slice(0, 300)]
      }
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
          running: false,
          speaker: '',
          pending: null,
        }
        return { events: [{ type: 'chat.conclusion', payload: { round, fallback } }, chatTransitionEvent(concluded, 'conclude', hostAuthor, '系统总结完成')] }
      })
      if (updated !== null) emit('room', store.readRoom(roomId) ?? updated)
      void refresh()
      return { started: true, round, turns: completed, fallback }
    } catch (error) {
      systemNotice({ store, roomId, text: '聊天室调度出了点问题；待处理。', error })
      return { started: true, error: String(error?.message ?? error) }
    } finally {
      runs.delete(roomId)
      store.cancelWork?.(runItemId)
      const current = store.readRoom(roomId)
      if (current?.chat?.running === true) {
        patch(state => {
          const rolled = transitionChat(state.chat.phase ?? 'discussing', 'abort')
          state.chat = {
            ...state.chat,
            running: false,
            speaker: '',
            pending: null,
            ...(rolled.ok ? { phase: rolled.state } : {}),
          }
          return { events: rolled.ok ? [chatTransitionEvent(rolled, 'abort', 'system', '聊天调度中止')] : [] }
        })
      }
      void refresh()
    }
  }

  const hostIntent = async (inputRoom, text) => {
    if (runs.has(roomId)) return { action: 'reply', reply: '这一轮还在进行，等他们说完再继续。', speakers: [] }
    const room = store.readRoom(roomId) ?? inputRoom
    if (transport.ready() !== true) return { action: 'reply', reply: '聊天室还没准备好。', speakers: [] }
    const speakers = (room.members ?? []).map(member => member.id)
    const ask = async prompt => {
      const before = await transport.messageIds()
      const sent = await sendToMember('host', prompt)
      hidePrompt(sent?.messageId)
      const reply = await waitForBot('host', before, { cancelled: false })
      return reply === null ? null : String(reply.text ?? reply.turn?.reply ?? '')
    }
    const allowOpen = room.lodge === true && speakers.length === 0
    const prompt = hostIntentPrompt({
      room,
      text,
      turnLimit: chatTurnLimitOf(room),
      phase: room.chat?.phase ?? '',
      linkedRooms: linkedRoomBriefs({ store, room }),
      // 准入：这句话是不是明确拒绝开轮，先算成事实交给模型。
      roundAllowed: !roundVetoed(text),
    })
    const first = await ask(prompt)
    if (first === null) return { action: 'reply', reply: '我刚才没接住，再说一次？', speakers: [] }
    const parsed = parseHostIntent(first, { speakers, allowOpen })
    if (parsed.structured === true) return finalizeHostIntent(parsed, text)
    // 第一次没给 JSON 就再要一次，只补格式，不重新理解。
    const repaired = await ask([
      '上一次回复不是 JSON，没法执行。',
      '只回一个 JSON，不要解释：',
      allowOpen
        ? '{"action":"reply","reply":"..."} 或 {"action":"open","room":"studio" 或 "chat","reply":"..."}'
        : '{"action":"reply","reply":"..."} 或 {"action":"round","speakers":["成员id"],"reply":"..."}',
    ].join('\n'))
    if (repaired === null) return parsed
    const second = parseHostIntent(repaired, { speakers, allowOpen })
    if (second.structured !== true) return parsed
    return finalizeHostIntent(second, text)
  }

  return { start, hostIntent, cancel, isRunning: () => runs.has(roomId) }
}
