import { initialChatState } from '../../room-types/chat.js'
import * as type from '../../room-types/chat.js'
import { isChatSystemNoise } from '../../room-chat.js'
import { systemNotice } from '../../notices.js'
import { LODGE_HOST_LABEL } from '../../member-labels.js'
import { personalityPrompt } from '../../../../shared/personalities.js'
import { CHAT_HOST_SOUL, CHAT_VOICE } from '../../../../shared/chat-voice.js'
import { stancePrompt } from '../../../../shared/chat-stances.js'
import { chatProjection } from './projection.js'
import { chatIssuesOf, chatRetroOf } from './issues.js'

// 聊天室的创建、投影和运行时都收在这里；共享层只调用钩子，不判断房型。
export const chatKind = {
  id: 'chat',
  type,
  owns: typeId => typeId === 'chat',

  memberPrompt: () => '',
  demoMessage: '这是示例房间，不接模型；要动手就把结论转成工作室任务。',

  memberRole: member => ({
    roleKind: 'participant',
    roleProfile: member.name,
    skills: [],
    ...(member.role === 'lead' ? { isHost: true } : {}),
  }),

  // 界面上只显示今晚请到的班底；没被请到的人还在基座里，但不在这一轮的房间里。
  membersOf: room => {
    const ids = Array.isArray(room?.chat?.castIds) ? room.chat.castIds : []
    const members = Array.isArray(room?.members) ? room.members : []
    return ids.length === 0 ? members : members.filter(member => ids.includes(member.id))
  },

  // 聊天室成员只带讨论纪律，不继承工作室的执行 SOP；可以读文件和只读公网。
  memberSoul: member => {
    const voice = typeof member.voice === 'string' ? member.voice.trim() : ''
    return [
      `你是${member.name}，在聊天室里像普通人一样说话：有自己的观点和语气，可以直接反驳。用中文，一条消息只说一个想法，多数 15–35 字；可以只说“同意”或问一句。要展开时最多 2 个短点，总长不超过 80 字。你看得到别人的话，但保留自己的判断，不要为了合群改口；改变立场时说明是哪条依据说服了你。可以只读查看仓库和文件，也可以联网只读查资料，引用时写路径或链接；不写文件、不跑命令，登录、提交、发帖、下单这类外部动作先问人。不要写报告或工作日志；一条消息最多一处加粗，只给数字、时间或风险。`,
      voice === '' ? '' : `你的说话习惯：${voice}`,
      typeof member.lens === 'string' && member.lens.trim() !== '' ? `你固定只看的问题：${member.lens.trim()}` : '',
      CHAT_VOICE,
      stancePrompt(member.stance),
      personalityPrompt(member.personality),
    ].filter(Boolean).join('\n')
  },

  validateRoster: null,
  resolvePlan: () => null,
  requiresGate: false,
  evaluateGate: () => ({ decision: 'allow', issues: [], needsHumanReview: false, advice: [] }),
  supportsDelivery: false,
  supportsMemberAdd: false,
  supportsMemberRemove: false,
  allowsHostOnly: room => room?.lodge === true,
  busyNow: room => room?.chat?.running === true,
  approvalReadOnly: () => true,
  appliesStageDependencies: false,

  leadMemberIdOf: () => null,

  record: () => ({
    constraints: [
      '聊天室只读：成员可以读文件、联网只读和讨论；不写文件、不跑命令，外部动作先问人',
      '主持人按话题请 2–6 位；每轮发言默认“今晚人数 + 2”次，系统最后收结论',
      '成员固定，只能静音和换模型；不加、不删',
    ],
    chat: initialChatState(),
  }),

  initialMessages: () => [],

  provisionExtra: async ({ host: hostPort, short }) => {
    // 主持人是 Lodge 自己：不占发言位置，只用来开场和总结。
    const created = await hostPort.createHost({
      name: `LodgeHost${short}`,
      soul: CHAT_HOST_SOUL,
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
    void live.startChat(room, { selectCast: true }).catch(error => {
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
  hiddenMessageOf: chatProjection.hiddenMessageOf,
  acceptsDelta: chatProjection.acceptsDelta,

  refresh: chatBase => ({
    chatUnread: chatBase?.unread === true,
  }),

  markMemberFailure: () => {},
  projectWork: () => null,
  deliveryOf: () => null,
  hostOf: room => room.chatHost ?? null,
  speakerOf: room => room.chat?.speaker ?? '',
  issuesOf: chatIssuesOf,
  retroOf: chatRetroOf,
}
