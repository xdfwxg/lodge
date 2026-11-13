import { createChatScheduler } from './scheduler.js'

// 聊天室策略：只有随机发言、主持总结和拍板，没有阶段、验收或交付回合。
export const createChatStrategy = ({ store, engine, emit, refreshRoom }) => ({
  owns: typeId => typeId === 'chat',

  create(entry, room) {
    entry.chatRun = createChatScheduler({
      store,
      engine,
      roomId: room.id,
      emit,
      refresh: () => refreshRoom(entry, { force: true }),
    })
  },

  detach(entry) {
    entry.chatRun?.cancel()
  },

  busyReview: () => false,
  isRunning: entry => entry.chatRun?.isRunning() === true,

  resume: async () => {},

  resumeIfRunning(entry, room) {
    if (room.state === 'active' && room.chat?.running === true) void entry.chatRun.start(room)
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
  sendToSeat: async () => { throw new Error('聊天室没有席位派发') },
})
