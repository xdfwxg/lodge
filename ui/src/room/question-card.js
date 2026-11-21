import { createElement as h, useState } from 'react'
import { BotAvatar } from '../marks.js'
import { Markdown, Speaker } from '../message-cards.js'
import { cardActionsOf } from '../../../shared/attempt.js'

// 基座的问答卡：选项是一等答案，也可以自己写；回答走同一个 card request。
// 卡片状态由阶段 + 重做轮次决定：open 可答，answered 已答，stale 已失效。
export function QuestionCard({ message, member, onAnswer = null, state = 'open' }) {
  const [text, setText] = useState('')
  const card = message.meta?.card ?? {}
  const options = Array.isArray(card.options) ? card.options.filter(option => typeof option === 'string') : []
  const open = cardActionsOf({ kind: 'question', state }).includes('answer')
  const answer = value => {
    const next = String(value ?? '').trim()
    if (next === '' || typeof onAnswer !== 'function' || !open) return
    onAnswer(message.authorId, card.requestId, next)
    setText('')
  }
  const head = open
    ? card.subtitle || '待回答'
    : state === 'answered' ? '已回答' : '这一步已经变了'
  return h('div', {
    className: 'crew-msg crew-msg-chat',
    'data-card-state': state,
    'data-room-decision': open ? '' : undefined,
  },
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-inline-speaker' },
        member === null || member === undefined
          ? null
          : h('span', { className: 'crew-inline-avatar' }, h(BotAvatar, { bot: member, size: 30, live: false })),
        h(Speaker, { member, ts: message.ts })),
      h('div', { className: 'crew-card crew-question-card' },
        h('div', { className: 'crew-card-head' }, head),
        h('div', { className: 'crew-card-body' },
          h(Markdown, { text: message.text, variant: 'compact' }),
          open
            ? h('div', null,
              options.length === 0
                ? null
                : h('div', { className: 'crew-question-options' },
                  options.map(option => h('button', {
                    key: option,
                    type: 'button',
                    className: 'crew-choice',
                    onClick: () => answer(option),
                  }, option))),
              h('form', {
                className: 'crew-question-answer',
                onSubmit: event => {
                  event.preventDefault()
                  answer(text)
                },
              },
              h('input', {
                className: 'crew-goal-input',
                value: text,
                onChange: event => setText(event.target.value),
                placeholder: '写下回答…',
                'aria-label': '回答',
              }),
              h('button', { type: 'submit', className: 'crew-choice', disabled: text.trim() === '' }, '回答')))
            : h('div', { className: 'crew-req-note' },
              state === 'answered' ? '这张问题已经回答。' : '这一步已经结束或重开，这张卡已失效。')))))
}
