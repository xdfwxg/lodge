import { createElement as h } from 'react'
import { GoalForm } from './goal-form.js'

// 前门给两条并列的路：聊一聊，或做出来。房间、队伍和过程都在后面出现。
export function HomeView({ onSubmit, onSample, onDiscuss = null, onAdjust = null, error = null }) {
  return h('main', { className: 'dsb-main crew-home' },
    h('div', { className: 'crew-home-inner' },
      h('div', { className: 'crew-home-brand' },
        h('img', { src: '/logo.svg', alt: '', width: 26, height: 26 }),
        h('b', null, 'Lodge')),
      h('h1', null, '想聊一聊，还是做出来？'),
      h(GoalForm, {
        onSubmit,
        onDiscuss,
        onAdjust,
        onSample,
        error,
      })))
}
