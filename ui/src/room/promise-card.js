import { Fragment, createElement as h, useState } from 'react'
import { promiseScheduleText } from '../../../shared/promise.js'
import { timeOf } from '../view-format.js'
import { PromiseDialog } from './promise-dialog.js'

const whenTextOf = ts => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getMonth() + 1}月${date.getDate()}日 ${timeOf(ts)}`
}

const statusTextOf = promise => {
  if (promise.status === 'paused') return '暂停了'
  if (promise.status === 'stopped') return '已经停了'
  if (promise.lastRunStatus === 'failed') return '上次没开起来'
  if (promise.lastRunStatus === 'skipped') return '上次跳过'
  if (promise.lastChange === 'no') return '上次没变化'
  if (promise.lastChange === 'yes') return '上次有变化'
  if (promise.lastChange === 'first' && (promise.runs ?? 0) <= 1) return '第一期'
  if (Number.isFinite(promise.lastRunAt)) return `上次 ${whenTextOf(promise.lastRunAt)}`
  return '还没做'
}

// 说好的一件事只占一行：它答应什么、下次什么时候、上次做到没有。
// 结果仍在时间线里；这里只负责“这件事还在不在”。
export function PromiseCard({ room, onRun, onPause, onResume, onStop, onUpdate = null }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const promise = room?.promise ?? null
  if (promise === null) return null
  const active = promise.status === 'active'
  const closeThen = action => () => {
    setMoreOpen(false)
    action()
  }
  const emailTo = promise.lastEmailTo || promise.delivery?.to || ''
  const emailText = promise.delivery?.channel === 'email'
    ? promise.lastEmailStatus === 'sent'
      ? `已发到 ${emailTo}`
      : promise.lastEmailStatus === 'failed'
        ? '邮件没发出去'
        : `发到 ${emailTo}`
    : ''
  const meta = [
    active && Number.isFinite(promise.nextAt) ? `下次 ${whenTextOf(promise.nextAt)}` : '',
    statusTextOf(promise),
    emailText,
    (promise.runs ?? 0) > 0 ? `已做 ${promise.runs} 次` : '',
  ].filter(Boolean).join(' · ')
  return h(Fragment, null,
    h('section', {
      className: 'crew-promise',
      'data-status': promise.status,
      'aria-label': '说好的事',
    },
    h('div', { className: 'crew-promise-main' },
      h('div', { className: 'crew-promise-head' },
        h('span', { className: 'crew-promise-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'crew-promise-kicker' }, '说好的'),
        h('span', { className: 'crew-promise-when' }, promiseScheduleText(promise.schedule))),
      h('p', { className: 'crew-promise-text', title: promise.text }, promise.text),
      h('p', { className: 'crew-promise-meta' }, meta)),
    h('div', { className: 'crew-promise-actions' },
      active
        ? h('button', { type: 'button', className: 'crew-link', onClick: onRun }, '现在跑一次')
        : h('button', { type: 'button', className: 'crew-link', onClick: onResume }, promise.status === 'stopped' ? '重新开始' : '恢复'),
      promise.status === 'stopped'
        ? null
        : h('details', {
          className: 'crew-promise-more',
          open: moreOpen,
          onToggle: event => setMoreOpen(event.currentTarget.open),
        },
        h('summary', { 'aria-label': '更多' }, '⋯'),
        h('div', { className: 'crew-promise-menu' },
          onUpdate !== null
            ? h('button', {
              type: 'button',
              className: 'crew-promise-menu-item',
              onClick: closeThen(() => setEditing(true)),
            }, '改一下')
            : null,
          active
            ? h('button', { type: 'button', className: 'crew-promise-menu-item', onClick: closeThen(onPause) }, '暂停')
            : null,
          h('button', { type: 'button', className: 'crew-promise-menu-item', onClick: closeThen(onStop) }, '不做了'))))),
    editing
      ? h(PromiseDialog, {
        promise,
        onClose: () => setEditing(false),
        onSave: input => onUpdate(input),
      })
      : null)
}
