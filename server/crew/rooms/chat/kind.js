import { CHAT_TURNS_PER_ROUND } from '../../room-types/chat.js'
import * as type from '../../room-types/chat.js'
import { isChatSystemNoise } from '../../room-chat.js'
import { LODGE_HOST_LABEL } from '../../seat-labels.js'
import { personalityPrompt } from '../../../../shared/personalities.js'
import { chatProjection } from './projection.js'

// 聊天室的创建、投影和运行时都收在这里；共享层只调用钩子，不判断房型。
export const chatKind = {
  id: 'chat',
  type,
  owns: typeId => typeId === 'chat',

  seatRole: seat => ({
    roleKind: 'participant',
    roleProfile: seat.name,
    ...(seat.role === 'lead' ? { isHost: true } : {}),
  }),

  // 聊天室席位只带讨论纪律，不继承工作室的执行 SOP。
  seatSoul: seat => `你是${seat.name}。当前是聊天室，只讨论话题、补充观点与质疑；不改文件、不调用工具。用中文发言，控制在 200 字以内，直接回复。\n${personalityPrompt(seat.personality)}`,

  validateRoster: null,
  resolvePlan: () => null,
  requiresGate: false,
  evaluateGate: () => ({ decision: 'allow', issues: [], needsHumanReview: false, advice: [] }),
  supportsDelivery: false,
  acceptsChatDecision: true,
  approvalReadOnly: () => false,
  appliesStageDependencies: false,

  leadSeatOf: () => null,

  record: ({ chatLimit }) => {
    const limit = Number.isInteger(chatLimit) ? chatLimit : CHAT_TURNS_PER_ROUND
    return {
      engine: 'chat',
      constraints: [
        '聊天室只读：成员只讨论，不执行工具、不改文件',
        `系统随机唤醒成员，每轮 ${limit} 次；主持人最后总结`,
        `结论由你认可；不认可就继续讨论 ${limit} 次`,
      ],
      chat: {
        round: 1,
        phase: 'discussing',
        turnLimit: limit,
        turns: 0,
        conclusionId: null,
        accepted: false,
        running: false,
        speaker: '',
        note: '',
      },
    }
  },

  initialMessages: () => [],

  provisionExtra: async ({ engine, short }) => {
    // 主持人是 Lodge 自己：不占发言席位，只用来开场和总结。
    const host = await engine.createSeatBot({
      name: `LodgeHost${short}`,
      soul: '你是 Lodge 的主持人。你只负责开场、总结和收敛讨论，不替发言者下结论；不要调用工具。',
      approval: 'ask',
    })
    return {
      members: [host.id],
      leadId: host.id,
      chatHost: { memberRef: host.id, name: host.name, displayName: LODGE_HOST_LABEL },
      cleanup: () => engine.deleteSeatBot(host.id),
    }
  },

  start: async ({ store, live, room }) => {
    void live.startChat(room).catch(error => {
      store.appendMessage(room.id, { kind: 'system', text: `聊天室启动失败：${error?.message ?? error}` })
    })
    return room
  },

  needsYou: room => {
    const chat = room.chat
    if (!chat || chat.running === true || chat.accepted === true) return null
    if (chat.phase === 'awaiting_decision') return { kind: 'decision', stage: null, label: '等你定' }
    return { kind: 'idle', stage: null, label: '可继续' }
  },

  stateOf: room => room.chat?.phase ?? 'discussing',

  filterMessages: messages => chatProjection.filterMessages(messages, isChatSystemNoise),
  hideActivity: chatProjection.hideActivity,
  acceptsDelta: chatProjection.acceptsDelta,

  refresh: (chatBase, toSeat, toSeats) => ({
    chatWorking: chatBase?.working === true,
    chatBusySeat: toSeat(chatBase?.busyRef) ?? '',
    chatQueue: (chatBase?.queue ?? []).map(item => ({
      seat: toSeat(item.memberRef),
      state: item.state,
      position: item.position,
      of: item.of,
      waitingFor: item.waitingForRef === undefined ? null : toSeat(item.waitingForRef),
    })),
    chatHolds: toSeats(chatBase?.holds),
    chatUnread: chatBase?.unread === true,
  }),

  onSeatFailure: () => {},
  deliveryOf: () => null,
  hostOf: room => room.chatHost ?? null,
  speakerOf: room => room.chat?.speaker ?? '',
  bulletinAcceptance: () => '人确认',
}
