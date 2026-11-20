import { CHAT_TURNS_PER_ROUND } from '../../room-types/chat.js'
import * as type from '../../room-types/chat.js'
import { isChatSystemNoise } from '../../room-chat.js'
import { systemNotice } from '../../notices.js'
import { LODGE_HOST_LABEL } from '../../member-labels.js'
import { personalityPrompt } from '../../../../shared/personalities.js'
import { chatProjection } from './projection.js'

// 聊天室的创建、投影和运行时都收在这里；共享层只调用钩子，不判断房型。
export const chatKind = {
  id: 'chat',
  type,
  owns: typeId => typeId === 'chat',

  memberRole: member => ({
    roleKind: 'participant',
    roleProfile: member.name,
    ...(member.role === 'lead' ? { isHost: true } : {}),
  }),

  // 聊天室成员只带讨论纪律，不继承工作室的执行 SOP。
  memberSoul: member => `你是${member.name}，在一个聊天室里就像普通人一样说话：有自己的观点和语气，可以直接反驳别人。用中文，控制在 200 字以内；这里只聊天，不改文件、不调用工具。\n${personalityPrompt(member.personality)}`,

  validateRoster: null,
  resolvePlan: () => null,
  requiresGate: false,
  evaluateGate: () => ({ decision: 'allow', issues: [], needsHumanReview: false, advice: [] }),
  supportsDelivery: false,
  supportsRoutine: false,
  followup: null,
  approvalReadOnly: () => false,
  appliesStageDependencies: false,

  leadMemberIdOf: () => null,

  record: ({ chatLimit }) => {
    const limit = Number.isInteger(chatLimit) ? chatLimit : CHAT_TURNS_PER_ROUND
    return {
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
        running: false,
        speaker: '',
        note: '',
      },
    }
  },

  initialMessages: () => [],

  provisionExtra: async ({ host: hostPort, short }) => {
    // 主持人是 Lodge 自己：不占发言位置，只用来开场和总结。
    const created = await hostPort.createHost({
      name: `LodgeHost${short}`,
      soul: '你是 Lodge 的主持人。你只负责开场、总结和收敛讨论，不替发言者下结论；不要调用工具。',
      approval: 'ask',
    })
    return {
      members: [created.id],
      leadId: created.id,
      chatHost: { memberRef: created.id, name: created.name, displayName: LODGE_HOST_LABEL },
      cleanup: () => hostPort.retireHost(created.id),
    }
  },

  start: async ({ store, live, room }) => {
    void live.startChat(room).catch(error => {
      systemNotice({ store, roomId: room.id, text: '聊天室没启动起来；稍后再试。', error })
    })
    return room
  },

  needsYou: room => {
    // 聊天室没有“待处理的结论”。只有真的出错才打断用户；聊到一半或聊完都只是状态。
    if (room.memberError !== undefined || room.pauseReason === 'member_error') {
      return { kind: 'error', stage: null, label: '成员没回应' }
    }
    return null
  },

  stateOf: room => room.chat?.phase ?? 'discussing',

  filterMessages: messages => chatProjection.filterMessages(messages, isChatSystemNoise),
  hideActivity: chatProjection.hideActivity,
  acceptsDelta: chatProjection.acceptsDelta,

  refresh: chatBase => ({
    chatUnread: chatBase?.unread === true,
  }),

  markMemberFailure: () => {},
  projectWork: () => null,
  deliveryOf: () => null,
  hostOf: room => room.chatHost ?? null,
  speakerOf: room => room.chat?.speaker ?? '',
  bulletinAcceptance: () => '人确认',
}
