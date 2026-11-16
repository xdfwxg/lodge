import { chatFacade } from './facade.js'
import { createChatScheduler } from './scheduler.js'
import { deliverToSeat } from '../../surface-delivery.js'

// 聊天室上下文运行时：只有随机发言、主持总结和拍板，没有阶段、验收或交付回合。
export const createChatRuntime = ({ store, engine, emit, refreshRoom }) => {
  return {
    owns: typeId => typeId === 'chat',

    create(entry, room) {
      entry.chatRun = createChatScheduler({
        store,
        engine,
        sendToSeat: (seat, text, options = {}) => deliverToSeat({
          engine,
          store,
          roomId: entry.roomId,
          room,
          seat,
          text,
          intent: seat === 'host' ? 'notice' : 'chat',
          ...options,
        }),
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

    // 聊天室只放行只读轻工具；写文件、跑命令和完整执行引擎都不挂在这里。
    permissionCard: async (entry, seat, message, chat) => {
      const room = store.readRoom(entry.roomId)
      const spec = room?.seatSpecs?.find(item => item.id === seat)
      const allowed = message.card.action === 'read'
      try {
        await engine.answerCard({
          sessionRef: chat.sessionRef,
          requestId: message.card.requestId,
          behavior: allowed ? 'allow' : 'deny',
        })
        if (!allowed) {
          store.appendMessage(entry.roomId, {
            kind: 'system',
            text: `聊天室只放行只读工具：${spec?.name ?? seat ?? '成员'} 被拒绝使用 ${message.card.tool ?? message.card.action ?? '该工具'}；要执行请新建工作室。`,
          })
        }
      } catch (error) {
        store.appendMessage(entry.roomId, { kind: 'system', text: `聊天权限卡处理失败：${error?.message ?? error}` })
      }
    },

    resume: async () => {},

    resumeIfRunning(entry, room) {
      if (room.state === 'active' && chatFacade.runningOf(room)) void entry.chatRun.start(room)
    },

    start(entry, room, options = {}) {
      return entry.chatRun.start(room, options)
    },

    continue(entry, room, note = '') {
      return entry.chatRun.start(store.readRoom(room.id) ?? room, { note })
    },

    cancel(entry) {
      entry.chatRun?.cancel()
    },

    requestReview: async () => { throw new Error('聊天室没有验收回合') },
    startStage: async () => { throw new Error('聊天室没有阶段执行') },
    sendToSeat: (entry, room, seat, text, options = {}) => deliverToSeat({
      engine,
      store,
      roomId: entry.roomId,
      room,
      seat,
      text,
      intent: seat === 'host' ? 'notice' : 'chat',
      ...options,
    }),
  }
}
