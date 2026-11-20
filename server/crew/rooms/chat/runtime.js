import { chatFacade } from './facade.js'
import { createChatScheduler } from './scheduler.js'
import { addTurnUsage } from '../../../../shared/usage.js'
import { createChatTransport } from './transport.js'
import { deliverToMember } from '../../surface-delivery.js'
import { memberOf } from '../../room-members.js'
import { systemNotice } from '../../notices.js'
import { isReadOnlyResearchTool } from '../../../../shared/room-access.js'

// 聊天室上下文运行时：只有随机发言、主持总结和拍板，没有阶段、验收或交付回合。
export const createChatRuntime = ({ store, engine, emit, refreshRoom }) => {
  const sendMember = (roomId, room, memberId, text, options = {}) => deliverToMember({
    engine,
    store,
    roomId,
    room,
    memberId,
    text,
    intent: memberId === 'host' ? 'notice' : 'chat',
    ...options,
  })

  return {
    owns: typeId => typeId === 'chat',

    create(entry, room) {
      entry.chatRun = createChatScheduler({
        store,
        transport: createChatTransport({ engine, store, roomId: entry.roomId }),
        sendToMember: (memberId, text, options = {}) => sendMember(entry.roomId, room, memberId, text, options),
        roomId: room.id,
        emit,
        refresh: () => refreshRoom(entry, { force: true }),
        syncChat: () => entry.chat?.sync?.() ?? Promise.resolve(),
      })
    },

    detach(entry) {
      entry.chatRun?.cancel()
    },

    busyReview: () => false,
    isRunning: entry => entry.chatRun?.isRunning() === true,
    acceptsDelta: true,

    // 聊天回合也花钱：只累计用量，不生成阶段诊断。
    captureTurn: (entry, message) => {
      const usage = message?.turn?.usage
      if (usage === undefined || usage === null) return
      store.updateRoom(entry.roomId, current => {
        const next = addTurnUsage(current.usage, usage)
        if (next === null) return null
        current.usage = next
        return { events: [] }
      })
    },

    // 聊天室只放行只读轻工具；写文件、跑命令和完整执行引擎都不挂在这里。
    permissionCard: async (entry, memberId, message, chat) => {
      const room = store.readRoom(entry.roomId)
      const spec = memberOf(room, memberId)
      const allowed = message.card.action === 'read' || isReadOnlyResearchTool(message.card.tool)
      try {
        await engine.answerCard({
          sessionRef: chat.sessionRef,
          requestId: message.card.requestId,
          behavior: allowed ? 'allow' : 'deny',
        })
        if (!allowed) {
          store.appendMessage(entry.roomId, {
            kind: 'system',
            text: `聊天室只放行只读工具：${spec?.name ?? memberId ?? '成员'} 被拒绝使用 ${message.card.tool ?? message.card.action ?? '该工具'}；要执行请新建工作室。`,
          })
        }
      } catch (error) {
        systemNotice({ store, roomId: entry.roomId, text: '有一步确认没能处理；需要你处理。', error })
      }
    },

    resume: async () => {},

    resumeIfRunning(entry, room) {
      if (room.chat?.hostThinking === true) {
        const updated = store.updateRoom(entry.roomId, current => {
          if (current.chat?.hostThinking !== true) return null
          current.chat = { ...current.chat, hostThinking: false }
          return { events: [] }
        })
        if (updated !== null) emit('room', updated)
      }
      if (room.state === 'active' && chatFacade.runningOf(room)) void entry.chatRun.start(room)
    },

    start(entry, room, options = {}) {
      return entry.chatRun.start(room, options)
    },

    continue(entry, room, note = '', options = {}) {
      return entry.chatRun.start(store.readRoom(room.id) ?? room, { note, speakerIds: options.speakerIds })
    },

    hostIntent(entry, room, text) {
      return entry.chatRun.hostIntent(store.readRoom(room.id) ?? room, text)
    },

    cancel(entry) {
      entry.chatRun?.cancel()
    },

    requestReview: async () => { throw new Error('聊天室没有验收回合') },
    startStage: async () => { throw new Error('聊天室没有阶段执行') },
    sendToMember: (entry, room, memberId, text, options = {}) => sendMember(entry.roomId, room, memberId, text, options),
  }
}
