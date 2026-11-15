import { createElement as h } from 'react'
import { BotAvatar } from '../../marks.js'
import { buildChatDecision, ChatStatusHeader } from './decision.js'
import { Timeline } from './timeline.js'
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
  header: ({ room }) => h(ChatStatusHeader, { room, decision: buildChatDecision(room) }),
  activity: () => null,
  transcript: ({ room, seats, actions }) => h(Timeline, {
    room,
    seats,
    hideKinds: [],
    onAccept: actions.chatAccept,
    onApproval: actions.approval,
    onContinueChat: actions.continueChat,
    onStartStudio: actions.startStudio,
  }),
  presence: () => null,
  composerPlaceholder: () => '加入讨论…',
  // 「正在输入」是聊天室自己的状态：谁在说、是否在总结，由这里判断。
  typing: ({ room, seats, locked }) => {
    const chat = room.chat ?? {}
    const seatId = room.chatBusySeat
      || chat.speaker
      || (room.busySeats?.length === 1 ? room.busySeats[0] : '')
    const active = !locked && seatId !== ''
      && (room.chatWorking === true || chat.running === true || room.busy === true)
    if (!active) return null
    const seat = seats.find(item => item.id === seatId) ?? null
    return h(TypingLine, { room, seat, summarizing: chat.phase === 'summarizing' })
  },
}
