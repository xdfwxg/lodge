import { Fragment, createElement as h } from 'react'
import { BotAvatar } from '../../marks.js'
import { buildChatDecision } from './decision.js'
import { ChatIsland } from './island.js'
import { ReceiptIntake } from './receipt-intake.js'
import { Timeline } from './timeline.js'
import { hostLabelOf } from '../host.js'
import { StatePanel } from '../../state-panel.js'

function TypingLine({ room, member, summarizing }) {
  return h('div', { className: 'crew-msg crew-typing-line' },
    h('div', { className: 'crew-msg-avatar' },
      member === null || member === undefined ? null : h(BotAvatar, { bot: member, size: 30, live: true })),
    h('div', { className: 'crew-msg-body' },
      h('span', { className: 'crew-typing-name' },
        summarizing ? `${hostLabelOf(room)} 正在总结` : '正在思考'),
      h('span', { className: 'crew-typing-dots', 'aria-hidden': true }, h('i'), h('i'), h('i'))))
}

// 聊天室的房间视图：只认自己的决策、时间线与输入中状态，不碰工作室。
export const chatView = {
  id: 'chat',
  buildViewModel: () => null,
  header: ({ room, actions }) => h(ChatIsland, { room, decision: buildChatDecision(room), actions }),
  activity: () => null,
  transcript: ({ room, members, actions }) => {
    const hasConversation = (room.messages ?? []).some(message => (
      message.kind === 'chat' || message.kind === 'chat_conclusion'
    ))
    const intro = hasConversation || room.chat?.running === true || room.state !== 'active'
      ? null
      : h(StatePanel, {
        key: `intro-${room.id}`,
        title: '这是一间聊天室',
        body: '成员先把事情聊清楚。聊出的结论可以交给工作室，由成员真正做出来，并留下结果和检查。',
      })
    return h(Fragment, null,
      intro,
      h(ReceiptIntake, { key: `receipt-${room.id}`, receipt: room.receipt }),
    h(Timeline, {
      key: `timeline-${room.id}`,
      room,
      members,
      hideKinds: [],
      onApproval: actions.approval,
      onAnswerCard: actions.answerCard,
      onCancelQueue: actions.cancelQueue,
      onSteerQueue: actions.steerQueue,
    }))
  },
  presence: () => null,
  composerPlaceholder: () => '加入讨论…',
  // 「正在输入」是聊天室自己的状态：谁在说、是否在总结，由这里判断。
  typing: ({ room, members, locked }) => {
    const chat = room.chat ?? {}
    const memberId = room.chatBusyMember
      || chat.speaker
      || (room.busyMembers?.length === 1 ? room.busyMembers[0] : '')
    const active = !locked && memberId !== ''
      && (room.chatWorking === true || chat.running === true || room.busy === true)
    if (!active) return null
    const member = members.find(item => item.id === memberId) ?? null
    return h(TypingLine, { room, member, summarizing: chat.phase === 'summarizing' })
  },
}
