import { createElement as h } from 'react'
import { BotAvatar } from '../../marks.js'
import { buildChatDecision, ChatStatusHeader } from './decision.js'
import { Timeline } from '../timeline.js'
import { hostLabelOf } from '../host.js'

function TypingLine({ room, seat, summarizing }) {
  return h('div', { className: 'crew-msg crew-typing-line' },
    h('div', { className: 'crew-msg-avatar' },
      seat === null || seat === undefined ? null : h(BotAvatar, { bot: seat, size: 30, live: true })),
    h('div', { className: 'crew-msg-body' },
      h('span', { className: 'crew-typing-name' },
        `${summarizing ? hostLabelOf(room) : seat?.name ?? '成员'} ${summarizing ? '正在总结' : '正在输入'}`),
      h('span', { className: 'crew-typing-dots', 'aria-hidden': true }, h('i'), h('i'), h('i'))))
}

// 聊天室的房间视图：只认自己的决策、时间线与输入中状态，不碰工作室。
export const chatView = {
  id: 'chat',
  buildViewModel: () => null,
  buildDecision: ({ room }) => buildChatDecision(room),
  header: ({ room, decision }) => h(ChatStatusHeader, { room, decision, actions: {} }),
  activity: () => null,
  decisionCard: () => null,
  transcript: ({ room, seats, actions }) => h(Timeline, {
    room,
    seats,
    hideKinds: [],
    onAccept: actions.chatAccept,
    onStageAccept: null,
    onApproval: actions.approval,
    onContinueChat: actions.continueChat,
    onStartStudio: actions.startStudio,
  }),
  presence: () => null,
  typing: ({ room, seat, summarizing }) => h(TypingLine, { room, seat, summarizing }),
}
