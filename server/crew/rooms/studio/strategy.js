import { createLiveTurns } from './turns.js'
import { createStudioEngine } from './prompts.js'

// 工作室策略：阶段派发、执行、验收、返工和签字都走群聊 @，没有讨论轮次。
export const createStudioStrategy = ({
  store,
  engine,
  emit,
  ports,
  onPlannerTool = null,
}) => {
  const studioEngine = createStudioEngine({ engine })

  return {
    owns: typeId => typeId === 'studio',

    create(entry, room) {
      entry.turns = createLiveTurns({
        store,
        engine,
        roomId: room.id,
        emit,
        sendToSeat: (seat, text) => studioEngine.send(store.readRoom(room.id) ?? room, text),
        commands: ports.commands,
        files: ports.files,
        skills: ports.skills,
        advisor: ports.advisor,
        onPlannerTool,
      })
      // 已落证据的回合在重启后会被基座历史重放；先标记，避免重复采集。
      entry.turns.seed(store.readMessages(room.id))
    },

    detach: () => {},

    captureTurn: (entry, message) => entry.turns.captureTurn(message.turn, message.authorRef),
    busyReview: entry => entry.turns.busyReview(),

    resume: async (entry, options) => {
      await entry.turns.resume(options)
    },

    resumeIfRunning: async () => {},

    start: async () => { throw new Error('工作室没有讨论流程') },
    continue: async () => { throw new Error('工作室没有继续讨论') },
    cancel: () => {},
    isRunning: () => false,

    requestReview: async (entry, stage) => entry.turns.requestReview(stage),
    startStage: async (entry, room, index, options = {}) => entry.turns.startStage(room, index, options),
    sendToSeat: async (entry, room, seat, text) => {
      const sent = await studioEngine.send(room, text)
      return { ...sent, messageId: null, broadcast: true }
    },
  }
}
