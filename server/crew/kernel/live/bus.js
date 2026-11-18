import { randomUUID } from 'node:crypto'
import { matchEcho, memberForRef } from './projection.js'
import { leadMemberOf } from '../../room-members.js'
import { pauseForMemberFailure } from './sync.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from '../../room-chat.js'
import { roomPresentationOfRoom } from '../../rooms/kinds.js'
import { supportsRuntime } from '../../runtime-port.js'
import { toBaseMentions, toDisplayMentions, toDisplayText, toIdMentions, unknownMentionsOf } from '../../member-labels.js'
import { systemNotice } from '../../notices.js'

// 隐藏主持与当前发言人由房型的 presentation 提供；总线不认识任何具体房型。
const FINAL_IDS_KEEP = 500

const hostOf = room => roomPresentationOfRoom(room)?.hostOf?.(room) ?? null
const speakerOf = room => roomPresentationOfRoom(room)?.speakerOf?.(room) ?? ''

// 基座回合是异步的；先把人的话落到房间里，输入框才不会看起来没反应。
// sendId 是基座的幂等键：发送响应和最终落库 ID 不同也能对上同一条话。
export const echoHumanMessage = ({ store, roomId, text, messageId, sendId, queueId }) => {
  const echo = {
    roomId,
    ts: Date.now(),
    kind: 'chat',
    authorId: 'you',
    text,
    meta: {
      echo: true,
      ...(typeof sendId === 'string' && sendId !== '' ? { sendId } : {}),
      ...(typeof queueId === 'string' && queueId !== '' ? { queueId } : {}),
    },
  }
  if (typeof sendId === 'string' && sendId !== '') {
    store.upsertMessage({ ...echo, id: `optimistic:${sendId}` })
  } else if (typeof messageId === 'string' && messageId !== '') {
    store.upsertMessage({ ...echo, id: messageId })
  } else {
    store.appendMessage(roomId, echo)
  }
}

// 房间对话走基座原生群聊：成员、@、上下文和沉默都由基座负责。
// 这里只管创建/重连/收发，不把聊天变成阶段回合。
export const createRoomChat = ({ store, engine, projector, refresh, emit = () => {}, onPermission, onTurn }) => {
  const streamOf = entry => {
    if (entry.chatStreams === undefined) entry.chatStreams = new Map()
    return entry.chatStreams
  }

  const finalIdsOf = entry => {
    if (entry.chatFinalIds === undefined) entry.chatFinalIds = new Set()
    return entry.chatFinalIds
  }

  const rememberFinal = (entry, id) => {
    const ids = finalIdsOf(entry)
    ids.add(id)
    while (ids.size > FINAL_IDS_KEEP) ids.delete(ids.values().next().value)
  }

  const applyDelta = (entry, room, event) => {
    // 流式是可选能力：runtime 没声明就不接增量，历史同步仍会把最终消息补进来。
    if (!supportsRuntime(engine, 'streaming')) return
    const current = store.readRoom(room.id) ?? room
    if (roomPresentationOfRoom(current)?.acceptsDelta !== true) return
    // 隐藏主持模型只负责总结，不把它的原始回复流进时间线；结论由 Lodge 写卡片。
    const host = hostOf(current)
    if (host !== null && entry.baseRoom?.busyRef === host.memberRef) return
    // 基座正在发言的人才是这一段 delta 的作者；自造的 speaker 只在拿不到基座状态时兜底。
    const memberId = (entry.baseRoom?.busyRef === undefined ? null : memberForRef(current, entry.baseRoom.busyRef))
      ?? speakerOf(current)
    if (typeof memberId !== 'string' || memberId === '') return
    const streams = streamOf(entry)
    const prior = streams.get(memberId)
    const turnId = typeof event.turnId === 'string' ? event.turnId : ''
    // 流式消息按回合区分：同一成员在一轮里发多次言时不能覆盖上一条。
    const sameTurn = prior !== undefined && prior.turnId === turnId
    const id = sameTurn ? prior.id : `stream:${room.id}:${memberId}:${turnId}`
    const existing = store.readMessages(room.id).find(message => message.id === id)
    const raw = sameTurn && typeof existing?.text === 'string'
      ? existing.text + event.delta
      : event.delta
    // 流式阶段也映射基座成员名；否则用户先看到内部名，回合结束才变角色名。
    const text = toDisplayText(current, raw)
    store.upsertMessage({
      id,
      roomId: room.id,
      ts: Date.now(),
      kind: 'chat',
      authorId: memberId,
      text,
      meta: { streaming: true, turnId },
    })
    streams.set(memberId, { id, turnId })
  }

  const finishStream = (entry, room, message) => {
    if (message.kind !== 'text' && message.kind !== 'turn') return false
    const finalIds = finalIdsOf(entry)
    if (finalIds.has(message.id)) return true
    const current = store.readRoom(room.id) ?? room
    if (roomPresentationOfRoom(current)?.acceptsDelta !== true) return false
    const memberId = memberForRef(current, message.authorRef) ?? speakerOf(current)
    if (typeof memberId !== 'string' || memberId === '') return false
    const streams = streamOf(entry)
    const state = streams.get(memberId)
    if (state === undefined) return false
    const raw = message.kind === 'turn' ? message.turn?.reply : message.text
    if (typeof raw !== 'string' || raw.trim() === '') {
      streams.delete(memberId)
      return false
    }
    // 流式回合的最终文本也要过一遍显示名映射，否则基座成员名会留在气泡里。
    const text = toDisplayText(current, raw)
    const existing = store.readMessages(room.id).find(item => item.id === state.id)
    store.upsertMessage({
      ...(existing ?? { id: state.id, roomId: room.id, kind: 'chat', authorId: memberId }),
      text,
      ts: message.at ?? Date.now(),
      meta: { ...(existing?.meta ?? {}), streaming: false, final: true, baseId: message.id },
    })
    streams.delete(memberId)
    rememberFinal(entry, message.id)
    return true
  }

  // 基座忙碌时消息会排队，发送响应 id 和最终落库 id 不同；回显先占位，落库后只补 baseId，不再重复投影。
  const projectMessage = (room, message) => {
    // 隐藏主持模型的原始回复只喂给总结卡，不进入聊天时间线。
    const host = hostOf(room)
    if (host !== null && message.authorRef === host.memberRef) return null
    // 流式消息已经落库的，同步历史时不再补一条同内容的消息。
    if (store.readMessages(room.id).some(item => item.meta?.baseId === message.id)) return null
    if (message.role === 'user') {
      const messages = store.readMessages(room.id)
      if (messages.some(item => item.meta?.baseId === message.id)) return null
      if (typeof message.sendId === 'string' && message.sendId !== '') {
        const echo = messages.find(item => item.meta?.sendId === message.sendId)
        if (echo !== undefined) {
          // 回显保留人输入的原话；基座消息里自动补的 @ 只用于唤醒，不改房间记录。
          const { queueId: _queued, ...meta } = echo.meta ?? {}
          store.upsertMessage({
            ...echo,
            ts: message.at ?? echo.ts,
            meta: { ...meta, baseId: message.id },
          })
          return null
        }
      }
      const echo = matchEcho(messages, toDisplayMentions(room, message.text), message.at)
      if (echo !== undefined) {
        const { queueId: _queued, ...meta } = echo.meta ?? {}
        store.upsertMessage({ ...echo, meta: { ...meta, baseId: message.id } })
        return null
      }
    }
    return projector.toStored(room.id, message)
  }

  const sync = async entry => {
    const room = store.readRoom(entry.roomId)
    const chat = room?.chatRoom
    if (chat === undefined) return
    const { messages } = await engine.history(chat.sessionRef)
    for (const message of messages) {
      // 权限卡归实时订阅和审批桥；历史里的旧卡不能再落库，否则会留下一个永远等人的问题。
      if (message.card?.requestType === 'permission') continue
      // 事件可能丢；同步历史时也要把流式消息收口，否则会多出一条最终消息。
      const streamed = finishStream(entry, room, message)
      const stored = streamed ? null : projectMessage(room, message)
      if (stored !== null) store.upsertMessage(stored)
      pauseForMemberFailure(store, entry, message)
    }
  }

  const ensure = async room => {
    if (room.chatRoom !== undefined) {
      // 群聊默认休眠：只有被 @ 的成员才加载。工作室和聊天室都走同一条总线。
      if (supportsRuntime(engine, 'mentions') && typeof engine.setRoomMentions === 'function') {
        try {
          await engine.setRoomMentions(room.chatRoom.id)
        } catch (error) {
          // 基座通道正在跑回合时会拒绝改规则；规则通常已经生效，不把它当成房间错误。
          if (!/409|working or waiting/.test(String(error?.message ?? error))) {
            systemNotice({ store, roomId: room.id, text: '房间的群聊没能准备好；需要你处理。', error })
          }
        }
      }
      return room
    }
    if (!supportsRuntime(engine, 'provisioning') || typeof engine.createRoom !== 'function') return room
    const host = hostOf(room)
    const members = [
      ...(room.members ?? []).map(member => member.body?.ref).filter(ref => typeof ref === 'string' && ref !== ''),
      ...(host === null ? [] : [host.memberRef]),
    ]
    if (members.length === 0) return room
    try {
      const chat = await engine.createRoom({
        name: roomChatName(room.name),
        goal: room.goal,
        bulletin: ROOM_CHAT_BULLETIN,
        members,
        cwd: room.repoPath,
        leadId: hostOf(room)?.memberRef ?? leadMemberOf(room)?.body?.ref ?? members[0],
        responder: { kind: 'mentions' },
      })
      const updated = store.updateRoom(room.id, current => {
        if (current.chatRoom !== undefined) return null
        current.chatRoom = chat
        return { events: [{ type: 'room.chat', payload: { id: chat.id } }] }
      })
      return updated ?? store.readRoom(room.id) ?? room
    } catch (error) {
      systemNotice({ store, roomId: room.id, text: '房间的群聊没能准备好；需要你处理。', error })
      return room
    }
  }

  const subscribe = (entry, room) => {
    const chat = room.chatRoom
    if (chat === undefined) return
    entry.chat = {
      roomRef: chat.id,
      sessionRef: chat.sessionRef,
      unsubscribe: null,
      sync: () => sync(entry),
    }
    entry.chat.unsubscribe = engine.subscribe({
      roomId: chat.id,
      sessionRef: chat.sessionRef,
      onState: state => {
        if (!state.connected) return
        void sync(entry).catch(error => {
          systemNotice({ store, roomId: room.id, text: '聊天记录没能对上；需要你处理。', error })
        })
      },
      onEvent: event => {
        if (event.type === 'room') {
          entry.baseRoom = event.room
          void refresh(entry, { force: true })
          return
        }
        if (event.type === 'delta') {
          applyDelta(entry, room, event)
          void refresh(entry)
          return
        }
        const message = event.message
        if (message === undefined) return
        const current = store.readRoom(room.id) ?? room
        if (message.card?.requestType === 'permission') {
          // 权限卡是可选能力：runtime 不支持时不接管，也不把卡片投进时间线。
          if (!supportsRuntime(engine, 'approvals')) return
          const memberId = memberForRef(current, message.authorRef)
          // 权限策略归房型策略；总线只把卡片交给当前房间的策略。
          void onPermission(entry, memberId, message, chat)
          return
        }
        if (message.kind === 'turn') onTurn?.(entry, current, message)
        const streamed = finishStream(entry, current, message)
        if (!streamed) {
          const stored = projectMessage(current, message)
          if (stored !== null) store.upsertMessage(stored)
        }
        pauseForMemberFailure(store, entry, message)
        void refresh(entry)
      },
    })
  }

  const send = async (room, text, { displayText = text, mentions = [] } = {}) => {
    const chat = room.chatRoom
    if (chat === undefined) throw new Error('房间聊天室还没准备好；重连房间后再试')
    // 基座原生支持 @everyone；产品文案 @所有人 只在这里映射，不自己展开成员。
    // 人挑中的成员先按 id 落成基座名，剩下的 @ 再按名字转换。
    const outgoing = toBaseMentions(room, toIdMentions(room, text, mentions)).split('@所有人').join('@everyone')
    const unknown = unknownMentionsOf(room, text)
    if (unknown.length > 0) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `这些 @ 没有对应成员：${unknown.map(name => `@${name}`).join('、')}；消息还是会发出，但他们收不到。`,
      })
    }
    const sendId = randomUUID()
    const sent = await engine.sendTurn({ roomId: chat.id, text: outgoing, sendId })
    echoHumanMessage({
      store,
      roomId: room.id,
      text: displayText,
      messageId: sent?.messageId,
      sendId,
      queueId: sent?.queueId,
    })
    return sent
  }

  const syncMembers = async room => {
    const chat = room.chatRoom
    if (chat === undefined || typeof engine.updateRoomMembers !== 'function') return
    const host = hostOf(room)
    const members = [
      ...(room.members ?? []).map(member => member.body?.ref).filter(ref => typeof ref === 'string' && ref !== ''),
      ...(host === null ? [] : [host.memberRef]),
    ]
    if (members.length === 0) return
    await engine.updateRoomMembers(chat.id, members)
  }

  const markRead = async room => {
    if (room.chatRoom === undefined || typeof engine.markRoomRead !== 'function') return
    await engine.markRoomRead(room.chatRoom.id)
    const updated = store.updateRoom(room.id, current => {
      if (current.chatUnread !== true) return null
      current.chatUnread = false
      return { events: [] }
    })
    if (updated !== null) emit('room', updated)
  }

  const detach = entry => {
    entry.chat?.unsubscribe?.()
    delete entry.chat
  }

  return { ensure, subscribe, send, detach, syncMembers, markRead }
}
