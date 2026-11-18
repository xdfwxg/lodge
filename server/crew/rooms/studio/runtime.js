import { createLiveTurns } from './turns.js'
import { createShadowReviewer } from './shadow-reviewer.js'
import { deliverToMember } from '../../surface-delivery.js'
import { leadMemberOf } from '../../room-members.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { systemNotice } from '../../notices.js'

// 工作室上下文运行时：阶段派发、执行、验收、重做和签字都走群聊 @，没有讨论轮次。
export const createStudioRuntime = ({
  store,
  engine,
  emit,
  ports,
  approvals,
  refreshRoom,
  confirmStage = null,
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
      entry.voicePending = false
      entry.voiceTurns = new Set()
      // 规划师自己的话：唤醒它、等它开口，再把它说的话交给下一位。平台不代写。
      const askPlanner = async prompt => {
        const current = store.readRoom(room.id) ?? room
        const lead = leadMemberOf(current)
        if (lead === undefined || lead === null) throw new Error('房间没有规划师')
        const before = store.readMessages(room.id).reduce((max, item) => Math.max(max, item.seq ?? 0), 0)
        entry.voicePending = true
        try {
          await sendMember(room.id, current, lead.id, `${prompt}\n${INTERNAL_PROMPT_MARKER}`, { intent: 'handoff', from: 'you' })
          const deadline = Date.now() + 90_000
          while (Date.now() < deadline) {
            const spoken = [...store.readMessages(room.id)].reverse().find(item => (
              item.kind === 'chat' &&
              item.authorId === lead.id &&
              (item.seq ?? 0) > before &&
              String(item.text ?? '').trim() !== ''
            ))
            if (spoken !== undefined) return String(spoken.text).trim()
            await new Promise(resolve => setTimeout(resolve, 750))
          }
          throw new Error('规划师没有回应')
        } finally {
          entry.voicePending = false
        }
      }
      // 影子评审用的是本房的一个隐藏成员，不走外部服务；没有它就自动跳过。
      const shadow = createShadowReviewer({
        engine,
        store,
        roomId: room.id,
        sendToMember: (memberId, text, options = {}) => sendMember(room.id, room, memberId, text, options),
      })
      entry.turns = createLiveTurns({
        store,
        engine,
        roomId: room.id,
        emit,
        sendToMember: (memberId, text, options = {}) => sendMember(room.id, room, memberId, text, options),
        askPlanner,
        commands: ports.commands,
        files: ports.files,
        writeDiagnostic: ports.roomFiles?.writeDiagnostic,
        confirmStage,
        shadow,
        expireCards: () => {
          const task = approvals.expireApprovals(entry, room.id, '这一步已经重做了')
          if (task !== undefined && task !== null && typeof task.catch === 'function') task.catch(() => {})
        },
      })
      // 已落证据的回合在重启后会被基座历史重放；先标记，避免重复采集。
      entry.turns.seed(store.readMessages(room.id))
    },

    detach: () => {},

    captureTurn: (entry, message) => {
      const lead = leadMemberOf(store.readRoom(entry.roomId) ?? {})
      const voiceTurn = lead?.body?.roomRef === message.authorRef &&
        (entry.voicePending === true || entry.voiceTurns?.has(message.id) === true)
      if (voiceTurn) {
        entry.voiceTurns?.delete(message.id)
        return
      }
      entry.turns.captureTurn(message.turn, message.authorRef)
    },
    busyReview: entry => entry.turns.busyReview(),
    acceptsDelta: false,

    permissionCard: async (entry, memberId, message, chat) => {
      try {
        await approvals.answerPermission(entry, memberId, message, refreshRoom, { sessionRef: chat.sessionRef })
      } catch (error) {
        systemNotice({ store, roomId: entry.roomId, text: '有一步确认没能处理；需要你处理。', error })
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
