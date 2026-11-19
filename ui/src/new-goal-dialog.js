import { createElement as h } from 'react'
import { useOverlay } from './overlay.js'
import { GoalForm } from './views/goal-form.js'

// 新建也回到同一件事：先写目标。房间类型和成员只在用户主动要求时出现。
export function NewGoalDialog({ open, onClose, onSubmit, onDiscuss = null, onAdjust = null }) {
  const overlay = useOverlay({ label: '新目标', onClose, active: open })
  if (!open) return null
  return h('div', { className: 'crew-overlay crew-overlay-center', onClick: onClose, ...overlay },
    h('div', {
      className: 'crew-dialog crew-goal-dialog',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '新目标',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-head' },
      h('button', {
        type: 'button',
        className: 'crew-dialog-close',
        'aria-label': '关闭',
        title: '关闭',
        onClick: onClose,
      }, '×')),
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, '今天想完成什么？'),
      h('p', null, '说清要的结果。Lodge 会安排。')),
    h('div', { className: 'crew-dialog-body' },
      h(GoalForm, { onSubmit, onDiscuss, onAdjust }))))
}
