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

const plainLine = line => line.replace(/\*\*/g, '').replace(/[。；;\s]+$/, '').trim()
const HEADING = /^(?:目标对齐|结论|决定|决策|开工前)(?:\s*·.*)?$/

export const decisionDetail = (text, items = []) => {
  const wanted = new Set(items.map(item => plainLine(item.question)))
  const kept = []
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '') continue
    const match = LIST_ITEM.exec(line)
    if (match !== null && wanted.has(plainLine(match[1]))) continue
    const plain = line.replace(/\*\*/g, '').trim()
    if (HEADING.test(plain)) continue
    const withoutMention = plain.replace(/@[A-Za-z0-9_\-一-龥]+/g, '').replace(/\s{2,}/g, ' ').trim()
    if (withoutMention !== '') kept.push(withoutMention)
  }
  return kept.join('\n')
}

export function DecisionBrief({
  message,
  member,
  items,
  pending,
  onAccept,
  disabled = false,
  actionLabel = '按这个继续',
}) {
  const detail = decisionDetail(message.text, items)
  return h('div', { className: 'crew-msg crew-msg-chat studio-decision' },
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { member, ts: message.ts, time: false, station: false }),
      h('div', { className: 'crew-card crew-decision-brief' },
        h('div', { className: 'crew-card-head' },
          `${items.length} 件事`,
          h('span', {
            className: 'crew-verdict',
            'data-pass': pending ? undefined : true,
            'data-pending': pending ? true : undefined,
          }, pending ? '等你定' : '已定')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-decision-list' },
            items.map((item, index) => h('div', { key: `decision-${index}`, className: 'crew-decision-item' },
              h('span', { className: 'crew-decision-num' }, index + 1),
              h('span', { className: 'crew-decision-text' }, item.question),
              item.recommendation === ''
                ? null
                : h('span', { className: 'crew-decision-rec' }, item.recommendation)))),
          detail === ''
            ? null
            : h('details', { className: 'crew-fold' },
              h('summary', null, '补充'),
              h(Markdown, { text: detail, variant: 'compact' }))),
        onAccept === undefined
          ? null
          : h('div', { className: 'crew-card-foot' },
            h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled,
              'data-room-decision': pending ? 'true' : undefined,
              onClick: onAccept,
            }, disabled ? '已暂停 · 继续后才能开工' : actionLabel)))))
}
