import { Fragment, createElement as h } from 'react'
import { buildChatDecision } from './decision.js'
import { ChatIsland } from './island.js'
import { ReceiptIntake } from './receipt-intake.js'
import { Timeline } from './timeline.js'
import { hostLabelOf } from '../host.js'
import { StatePanel } from '../../state-panel.js'
import { CrewStatusLine } from '../crew-status.js'
import { IslandRail } from '../../goal-island/rail.js'
import { TypingLine } from '../typing-line.js'


// 聊天室的房间视图：只认自己的决策、时间线与输入中状态，不碰工作室。
export const chatView = {
  id: 'chat',
  header: ({ state, room, members, actions }) => h(Fragment, null,
    h(ChatIsland, { room, decision: buildChatDecision(room), actions }),
    h('div', { className: 'crew-island-rail-wrap' },
      h(IslandRail, { rooms: state?.rooms ?? [], currentId: room.id, onSelect: actions?.selectRoom })),
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
        title: '先聊清楚',
        body: '定下来，再交给工作室做。',
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
