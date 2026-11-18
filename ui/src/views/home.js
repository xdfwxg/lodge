import { createElement as h, useState } from 'react'
import { humanErrorText } from '../error-text.js'

// 前门只做一件事：把目标交进去。房间、队伍和过程都在后面出现。
export function HomeView({ onSubmit, onSample, onAdjust = null, error = null }) {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const ready = goal.trim() !== ''
  const submit = async event => {
    event.preventDefault()
    if (!ready || busy) return
    setBusy(true)
    try {
      await onSubmit(goal.trim())
    } finally {
      setBusy(false)
    }
  }
  return h('main', { className: 'dsb-main crew-home' },
    h('div', { className: 'crew-home-inner' },
      h('div', { className: 'crew-home-brand' },
        h('img', { src: '/logo.svg', alt: '', width: 26, height: 26 }),
        h('b', null, 'Lodge')),
      h('h1', null, '今天想完成什么？'),
      h('form', { className: 'crew-home-form', onSubmit: submit },
        h('textarea', {
          className: 'crew-home-input',
          rows: 3,
          autoFocus: true,
          'aria-label': '今天想完成什么',
          placeholder: '例如：给设置页加上保存提示，刷新后仍然生效。',
          value: goal,
          disabled: busy,
          onChange: event => setGoal(event.target.value),
          onKeyDown: event => {
            if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
            event.preventDefault()
            submit(event)
          },
        }),
        h('button', { type: 'submit', className: 'crew-accept crew-home-start', disabled: !ready || busy }, busy ? '正在准备…' : '开始')),
      error === null || error === undefined
        ? null
        : h('p', { className: 'crew-home-error', role: 'alert' }, humanErrorText(error)),
      h('p', { className: 'crew-home-hint' }, '说清要的结果。Lodge 会找一个小队，一步步做完给你。'),
      h('div', { className: 'crew-home-links' },

        onAdjust === null
          ? null
          : h('button', {
            type: 'button',
            className: 'crew-link',
            onClick: () => onAdjust(goal.trim()),
          }, '先调整再开工'),
        h('button', { type: 'button', className: 'crew-link', onClick: onSample }, '先看看一间做完的示例'))))
}
