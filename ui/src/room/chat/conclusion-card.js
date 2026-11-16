import { createElement as h } from 'react'
import { Markdown, Speaker } from '../../message-cards.js'
import { timeOf } from '../../view-format.js'
import { IntakeSection } from '../intake-section.js'
import { chatConclusionHandoffOf } from './decision.js'

// 轮次结论是五字段交接单，不是一段散文。确认和开工仍由顶部的岛负责。
export function ChatConclusionCard({ message, seat, room }) {
  const meta = message.meta ?? {}
  const round = meta.round ?? 1
  const chat = room.chat ?? {}
  const currentRound = round === (chat.round ?? 1)
  const accepted = room.state === 'complete' && currentRound
  const handoff = chatConclusionHandoffOf(message, room)
  const fields = handoff ?? {
    topic: room?.goal ?? '',
    consensus: [],
    disagreements: [],
    constraints: [],
    todos: [],
  }
  const topic = fields.topic || room?.goal || '未给出主题'
  // 模型有时自带「第 N 轮总结」标题；卡头已经有轮次，正文不重复。
  const summary = String(message.text ?? '').replace(/^#{0,3}\s*第\s*\d+\s*轮\s*(总结|结论)[:：]?\s*\n+/, '')
  const narrativeOpen = handoff === null || meta.fallback === true
  return h('div', { className: 'crew-msg-conclusion crew-msg-chat' },
    h(Speaker, { seat, ts: message.ts, time: false, station: false }),
    h('div', { className: 'crew-card crew-conclusion', 'data-settled': accepted ? 'true' : undefined },
      h('div', { className: 'crew-card-body' },
        h('b', { className: 'crew-conclusion-title' }, `第 ${round} 轮结论`),
        meta.fallback === true
          ? h('p', { className: 'crew-field-hint' }, '主持人未能在限定时间内总结；以下是原始讨论摘要。')
          : null,
        h('div', { className: 'crew-conclusion-fields' },
          h('p', { className: 'crew-handoff-topic' }, topic),
          h(IntakeSection, {
            label: '共识',
            items: fields.consensus,
            empty: '没有记录共识',
          }),
          h(IntakeSection, {
            label: '未解决的分歧',
            items: fields.disagreements,
            warning: true,
            empty: '没有未解决的分歧',
          }),
          h(IntakeSection, {
            label: '约束',
            items: fields.constraints,
            empty: '没有额外约束',
          }),
          h(IntakeSection, {
            label: '待办',
            items: fields.todos,
            empty: '没有待办',
          })),
        summary.trim() === ''
          ? null
          : h('details', { className: 'crew-handoff-more', open: narrativeOpen || undefined },
            h('summary', null, meta.fallback === true ? '完整讨论' : '完整结论'),
            h('div', { className: 'crew-handoff-more-body' },
              h(Markdown, { text: summary, variant: 'compact' })))),
      accepted
        ? h('div', { className: 'crew-card-foot', 'data-settled': true },
          h('span', { className: 'crew-conclusion-signoff' }, `${seat?.name ?? 'Lodge 主持'} · ${timeOf(message.ts)}`))
        : null))
}
