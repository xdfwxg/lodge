import { createElement as h } from 'react'
import { Markdown, Speaker } from '../../message-cards.js'
import { timeOf } from '../../view-format.js'

// 轮次结论是记录，不是第二个决定入口：确认和开工都由房间顶部的岛负责。
export function ChatConclusionCard({ message, seat, room }) {
  const meta = message.meta ?? {}
  const round = meta.round ?? 1
  const chat = room.chat ?? {}
  const currentRound = round === (chat.round ?? 1)
  const accepted = room.state === 'complete' && currentRound
  // 模型有时自带「第 N 轮总结」标题；卡头已经有轮次，正文不重复。
  const summary = String(message.text ?? '').replace(/^#{0,3}\s*第\s*\d+\s*轮\s*(总结|结论)[:：]?\s*\n+/, '')
  return h('div', { className: 'crew-msg-conclusion crew-msg-chat' },
    h(Speaker, { seat, ts: message.ts, time: false, station: false }),
    h('div', { className: 'crew-card crew-conclusion', 'data-settled': accepted ? 'true' : undefined },
      h('div', { className: 'crew-card-body' },
        h('b', { className: 'crew-conclusion-title' }, `第 ${round} 轮结论`),
        meta.fallback === true
          ? h('p', { className: 'crew-field-hint' }, '主持人未能在限定时间内总结；以下是原始讨论摘要。')
          : null,
        h(Markdown, { text: summary, variant: 'compact' })),
      accepted
        ? h('div', { className: 'crew-card-foot', 'data-settled': true },
          h('span', { className: 'crew-conclusion-signoff' }, `${seat?.name ?? 'Lodge 主持'} · ${timeOf(message.ts)}`))
        : null))
}
