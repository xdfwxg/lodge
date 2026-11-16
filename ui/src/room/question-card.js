import { createElement as h, useState } from 'react'
import { BotAvatar } from '../marks.js'
import { Markdown, Speaker } from '../message-cards.js'

// 基座的问答卡：选项是一等答案，也可以自己写；回答走同一个 card request。
export function QuestionCard({ message, seat, onAnswer = null }) {
  const [text, setText] = useState('')
  const card = message.meta?.card ?? {}
  const options = Array.isArray(card.options) ? card.options.filter(option => typeof option === 'string') : []
  const answer = value => {
    const next = String(value ?? '').trim()
    if (next === '' || typeof onAnswer !== 'function') return
    onAnswer(message.authorId, card.requestId, next)
    setText('')
  }
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' },
      seat === null || seat === undefined ? null : h(BotAvatar, { bot: seat, size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { seat, ts: message.ts }),
      h('div', { className: 'crew-card crew-question-card' },
        h('div', { className: 'crew-card-head' }, card.subtitle || '需要你回答'),
        h('div', { className: 'crew-card-body' },
          h(Markdown, { text: message.text, variant: 'compact' }),
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
          h('button', { type: 'submit', className: 'crew-choice', disabled: text.trim() === '' }, '回答'))))))
}
