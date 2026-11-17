import { createLiveTurns } from './turns.js'
import { deliverToMember } from '../../surface-delivery.js'

// 工作室上下文运行时：阶段派发、执行、验收、重做和签字都走群聊 @，没有讨论轮次。
export const createStudioRuntime = ({
  store,
  engine,
  emit,
  ports,
  approvals,
  refreshRoom,
}) => {
  const sendMember = (roomId, room, memberId, text, options = {}) => deliverToMember({
    engine,
    store,
    roomId,
    room,
    memberId,
    text,
    ...options,
  })

  return {
    owns: typeId => typeId === 'studio',

    create(entry, room) {
      entry.turns = createLiveTurns({
        store,
        engine,
        roomId: room.id,
        emit,
        sendToMember: (memberId, text, options = {}) => sendMember(room.id, room, memberId, text, options),
        commands: ports.commands,
        files: ports.files,
        advisor: ports.advisor,
      })
      // 已落证据的回合在重启后会被基座历史重放；先标记，避免重复采集。
      entry.turns.seed(store.readMessages(room.id))
    },

    detach: () => {},

    captureTurn: (entry, message) => entry.turns.captureTurn(message.turn, message.authorRef),
    busyReview: entry => entry.turns.busyReview(),
    acceptsDelta: false,

    permissionCard: async (entry, memberId, message, chat) => {
      try {
        await approvals.answerPermission(entry, memberId, message, refreshRoom, { sessionRef: chat.sessionRef })
      } catch (error) {
        store.appendMessage(entry.roomId, { kind: 'system', text: `群聊权限卡处理失败：${error?.message ?? error}` })
      }
    },

    resume: async (entry, options) => {
      await entry.turns.resume(options)
    },

    resumeIfRunning: async (entry, room) => {
      const index = (room?.stages ?? []).findIndex(stage => stage.state === 'active')
      if (index >= 0) entry.turns.watchStageTimeout(index)
    },

    start: async () => { throw new Error('工作室没有讨论流程') },
    continue: async () => { throw new Error('工作室没有继续讨论') },
    cancel: () => {},
    isRunning: () => false,

    requestReview: async (entry, stage) => entry.turns.requestReview(stage),
    startStage: async (entry, room, index, options = {}) => entry.turns.startStage(room, index, options),
    sendToMember: (entry, room, memberId, text, options = {}) => sendMember(room.id, room, memberId, text, options),
  }
}
