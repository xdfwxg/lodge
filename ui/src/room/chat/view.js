import { Fragment, createElement as h } from 'react'
import { GoalIslandHeader } from '../../goal-island/adapter.js'
import { chatIslandGoal } from './island.js'
import { ReceiptIntake } from './receipt-intake.js'
import { Timeline } from './timeline.js'
import { hostLabelOf } from '../host.js'
import { StatePanel } from '../../state-panel.js'
import { PausedPanel } from '../paused-panel.js'
import { RoomReview } from '../room-review.js'
import { TypingLine } from '../typing-line.js'


// 聊天室的房间视图：只认自己的决策、时间线与输入中状态，不碰工作室。
export const chatView = {
  id: 'chat',
  className: 'crew-room-chat',
  header: ({ room, actions }) => {
    const island = h(GoalIslandHeader, {
      room,
      goal: chatIslandGoal(room),
      onOpenRoom: actions.selectRoom,
    })
    const grill = room.state === 'active' && room.live === true && typeof actions.send === 'function'
      ? h('div', { className: 'crew-chat-grill' },
        h('button', {
          type: 'button',
          className: 'crew-link',
          onClick: () => actions.send('拷问我这个想法'),
        }, '拷问我'))
      : null
    if (room.state !== 'paused') return grill === null ? island : h(Fragment, null, island, grill)
    return h(Fragment, null, island, grill, h(PausedPanel, {
      room,
      onResume: () => actions.resume(),
      onFixMember: memberId => actions.swapBody(memberId),
    }))
  },
  activity: () => null,
  transcript: ({ room, members, actions }) => {
    const hasConversation = (room.messages ?? []).some(message => (
      message.kind === 'chat' || message.kind === 'chat_conclusion'
    ))
    const intro = hasConversation || room.chat?.running === true || room.state !== 'active'
      ? null
      : h(StatePanel, {
        key: `intro-${room.id}`,
        title: '随便聊聊',
        body: '想聊就聊，聊到想做事时再转成工作室。',
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
      onStartStudio: actions.startStudio,
      onOpenRoom: actions.selectRoom,
    }),
    h(RoomReview, { key: `review-${room.id}`, room }))
  },
  presence: () => null,
  composerPlaceholder: ({ room }) => room.demo === true && room.live !== true
    ? '示例房间不接模型 · 已停在结论'
    : `对 ${hostLabelOf(room) || 'Lodge 主持'} 说…`,
  // 谁在发言由身体状态行说；这里只补主持人的“正在看”和“正在总结”。
  typing: ({ room, locked }) => {
    const chat = room.chat ?? {}
    if (chat.hostThinking === true) {
      return h(TypingLine, { label: `${hostLabelOf(room)} 正在看` })
    }
    return !locked && chat.phase === 'summarizing'
      ? h(TypingLine, { label: `${hostLabelOf(room)} 正在总结` })
      : null
  },
}
