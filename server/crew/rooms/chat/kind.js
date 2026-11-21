import { CHAT_TURNS_PER_ROUND } from '../../room-types/chat.js'
import * as type from '../../room-types/chat.js'
import { isChatSystemNoise } from '../../room-chat.js'
import { systemNotice } from '../../notices.js'
import { LODGE_HOST_LABEL } from '../../member-labels.js'
import { personalityPrompt } from '../../../../shared/personalities.js'
import { CHAT_HOST_VOICE, CHAT_VOICE } from '../../../../shared/chat-voice.js'
import { stancePrompt } from '../../../../shared/chat-stances.js'
import { chatProjection } from './projection.js'
import { CHAT_PHASE } from '../../../../shared/states.js'
import { MENTION_ALL } from '../../../../shared/mentions.js'

// 聊天室的创建、投影和运行时都收在这里；共享层只调用钩子，不判断房型。
export const chatKind = {
  id: 'chat',
  type,
  owns: typeId => typeId === 'chat',

  memberPrompt: () => '',
  demoMessage: '这是示例房间，不接模型；要动手就把结论转成工作室任务。',
  messagePolicy: ({ room, mentions = [] }) => {
    // 只认输入框成员选择器传来的 id；手打 @ 不算点名。
    if (mentions.includes(MENTION_ALL)) {
      // 结论后叫所有人 = 开新一轮；正在讨论时没有第二轮可开，交给主持说明。
      return room.chat?.phase === CHAT_PHASE.concluded && room.chat?.running !== true
        ? { type: 'round' }
        : { type: 'host' }
    }
    const named = mentions.some(id => (room.members ?? []).some(member => member.id === id))
    return named ? null : { type: 'host' }
  },

  memberRole: member => ({
    roleKind: 'participant',
    roleProfile: member.name,
    skills: [],
    ...(member.role === 'lead' ? { isHost: true } : {}),
  }),

  // 聊天室成员只带讨论纪律，不继承工作室的执行 SOP；可以读文件和只读公网。
  memberSoul: member => `你是${member.name}，在一个聊天室里就像普通人一样说话：有自己的观点和语气，可以直接反驳别人。用中文，控制在 200 字以内；可以只读查看仓库和文件，也可以联网只读查资料，引用时写路径或链接；不写文件、不跑命令，登录、提交、发帖、下单这类外部动作先问人。\n${CHAT_VOICE}\n${stancePrompt(member.stance)}\n${personalityPrompt(member.personality)}`,

  validateRoster: null,
  resolvePlan: () => null,
  requiresGate: false,
  evaluateGate: () => ({ decision: 'allow', issues: [], needsHumanReview: false, advice: [] }),
  supportsDelivery: false,
  supportsMemberAdd: false,
  allowsHostOnly: room => room?.lodge === true,
  busyNow: room => room?.chat?.running === true,
  approvalReadOnly: () => true,
  appliesStageDependencies: false,

  leadMemberIdOf: () => null,

  record: ({ chatLimit }) => {
    const limit = Number.isInteger(chatLimit) ? chatLimit : CHAT_TURNS_PER_ROUND
    return {
      constraints: [
        '聊天室只读：成员可以读文件、联网只读和讨论；不写文件、不跑命令，外部动作先问人',
        `系统随机唤醒成员，每轮 ${limit} 次；主持人最后总结`,
        `结论由你认可；不认可就继续讨论 ${limit} 次`,
      ],
      chat: {
        round: 1,
        phase: CHAT_PHASE.discussing,
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
      soul: `你是 Lodge 的主持人。你只负责开场、总结和收敛讨论，不替发言者下结论；不要调用工具。\n${CHAT_HOST_VOICE}`,
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
