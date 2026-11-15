import { createElement as h } from 'react'
import { Markdown, Speaker } from '../../message-cards.js'

const LIST_ITEM = /^\s*(?:\d+[.、)]|[-*•])\s+(.+)$/

// 规划师的开工说明常是“标题 + 三条问题”；把这三条抽成决策卡，别让用户读整段聊天。
export const parseDecisionItems = text => {
  const items = []
  for (const line of String(text ?? '').split('\n')) {
    const match = LIST_ITEM.exec(line)
    if (match === null) continue
    const plain = match[1].replace(/\*\*/g, '').trim()
    if (plain === '' || plain.startsWith('@')) continue
    const recommendation = /推荐[：:]\s*(.+)$/.exec(plain)
    const question = (recommendation === null ? plain : plain.slice(0, recommendation.index))
      .replace(/[。；;]\s*$/, '')
      .trim()
    items.push({
      question,
      recommendation: recommendation === null ? '' : recommendation[1].replace(/\*\*/g, '').trim(),
    })
    if (items.length >= 3) break
  }
  return items
}

export function DecisionBrief({ message, seat, items, pending, onAccept, disabled = false }) {
  return h('div', { className: 'crew-msg crew-msg-chat studio-decision' },
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts, time: false, station: false }),
      h('div', { className: 'crew-card crew-decision-brief' },
        h('div', { className: 'crew-card-head' },
          pending ? '需要你确认' : '开工前的确认',
          h('span', {
            className: 'crew-verdict',
            'data-pending': pending ? true : undefined,
            'data-pass': pending ? undefined : true,
          }, pending ? '待确认' : '已确认')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-decision-list' },
            items.map((item, index) => h('div', { key: `decision-${index}`, className: 'crew-decision-item' },
              h('span', { className: 'crew-decision-num' }, index + 1),
              h('span', { className: 'crew-decision-text' }, item.question),
              item.recommendation === ''
                ? null
                : h('span', { className: 'crew-decision-rec' }, item.recommendation)))),
          h('p', { className: 'crew-field-hint' }, pending
            ? '确认后开始派活；有不同意见，直接在下方说。'
            : '这次开工前已经确认过的事项。'),
          h('details', { className: 'crew-fold' },
            h('summary', null, '完整说明'),
            h(Markdown, { text: message.text, variant: 'compact' }))),
        onAccept === undefined
          ? null
          : h('div', { className: 'crew-card-foot' },
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled,
              onClick: onAccept,
            }, disabled ? '已暂停 · 继续后才能确认' : '确认，开始做')))))
}
