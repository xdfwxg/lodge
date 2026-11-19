import { createElement as h, useState } from 'react'
import { humanErrorText } from '../error-text.js'

// 前门给两条并列的路：聊一聊，或做出来。房间类型、成员和验收都在后面。
export function GoalForm({
  onSubmit,
  onDiscuss = null,
  onAdjust = null,
  onSample = null,
  error = null,
  startLabel = '做出来',
  hint = '说清要的结果，或者先聊一聊；Lodge 两样都接。',
  autoFocus = true,
}) {
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
  return h('form', { className: 'crew-home-form', onSubmit: submit },
    h('textarea', {
      className: 'crew-home-input',
      rows: 3,
      autoFocus,
      'aria-label': '今天想完成什么',
      placeholder: '说清要的结果，或者先说你想聊的方向。例如：给设置页加上保存提示，刷新后仍然生效。',
      value: goal,
      disabled: busy,
      onChange: event => setGoal(event.target.value),
      onKeyDown: event => {
        if (event.key !== 'Enter' || (!event.metaKey && !event.ctrlKey)) return
        event.preventDefault()
        submit(event)
      },
    }),
    h('div', { className: 'crew-home-actions' },
      h('button', { type: 'submit', className: 'crew-accept crew-home-start', disabled: !ready || busy }, busy ? '正在准备…' : startLabel),
      onDiscuss === null
        ? null
        : h('button', {
          type: 'button',
          className: 'crew-ghost crew-home-chat',
          disabled: busy,
          onClick: () => onDiscuss(goal.trim()),
        }, '聊一聊')),
    error === null || error === undefined
      ? null
      : h('p', { className: 'crew-home-error', role: 'alert' }, humanErrorText(error)),
    h('p', { className: 'crew-home-hint' }, hint),
    h('div', { className: 'crew-home-links' },
      onAdjust === null
        ? null
        : h('button', { type: 'button', className: 'crew-link', disabled: busy, onClick: () => onAdjust(goal.trim()) }, '更多选项'),
      onSample === null
        ? null
        : h('button', { type: 'button', className: 'crew-link', disabled: busy, onClick: onSample }, '先看看一间做完的示例')))
}
