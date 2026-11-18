import { createElement as h, useState } from 'react'

// 前门只做一件事：把目标交进去。房间、队伍和过程都在后面出现。
export function HomeView({ onSubmit, onSample }) {
  const [goal, setGoal] = useState('')
  const ready = goal.trim() !== ''
  const submit = event => {
    event.preventDefault()
    if (!ready) return
    onSubmit(goal.trim())
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
          onChange: event => setGoal(event.target.value),
          onKeyDown: event => {
            if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
            event.preventDefault()
            submit(event)
          },
        }),
        h('button', { type: 'submit', className: 'crew-accept crew-home-start', disabled: !ready }, '开始')),
      h('p', { className: 'crew-home-hint' }, '说清要的结果。Lodge 会找一个小队，一步步做完给你。'),
      h('button', { type: 'button', className: 'crew-link crew-home-sample', onClick: onSample }, '先看看一间做完的示例')))
}
