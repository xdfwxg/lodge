import { Fragment, createElement as h } from 'react'
import { BotAvatar } from '../../marks.js'
import { buildChatDecision } from './decision.js'
import { ChatIsland } from './island.js'
import { ReceiptIntake } from './receipt-intake.js'
import { Timeline } from './timeline.js'
import { hostLabelOf } from '../host.js'
import { StatePanel } from '../../state-panel.js'
import { CrewStatusLine } from '../crew-status.js'

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
  header: ({ room, members, actions }) => h(Fragment, null,
    h(ChatIsland, { room, decision: buildChatDecision(room), actions }),
    (room.state === 'active' || room.state === 'paused') && (members?.length ?? 0) > 0
      ? h('div', { className: 'crew-crew-status-wrap' },
        h(CrewStatusLine, {
          room,
          members,
          onSwap: actions.swapBody,
          labels: { lead: '主持中', member: '发言中' },
        }))
      : null),
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
  // 谁在发言由身体状态行说；这里只补主持人的“正在总结”。
  typing: ({ room, locked }) => {
    const chat = room.chat ?? {}
    const summarizing = !locked && chat.phase === 'summarizing'
    return summarizing ? h(TypingLine, { room, member: null, summarizing: true }) : null
  },
}
