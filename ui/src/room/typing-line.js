import { createElement as h } from 'react'

// 有人在说话：一行名字加三个点，不抢正在发生的事。
export function TypingLine({ label, detail = '' }) {
  return h('div', { className: 'crew-msg crew-msg-chat crew-typing-line' },
    h('div', { className: 'crew-msg-body' },
      h('span', { className: 'crew-typing-name' }, label),
      detail === '' ? null : h('span', { className: 'crew-typing-detail' }, detail),
      h('span', { className: 'crew-typing-dots', 'aria-hidden': true }, h('i'), h('i'), h('i'))))
}
