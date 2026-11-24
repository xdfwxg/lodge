import { createElement as h, useState } from 'react'
import {
  normalizePromiseDelivery,
  normalizePromiseSchedule,
  promiseDeliveryError,
  promiseScheduleError,
} from '../../../shared/promise.js'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 改口只改这张卡：做什么、多久一次、送回房间还是发邮箱。时钟仍是房间的。
export function PromiseDialog({ promise, onSave, onClose }) {
  const initialSchedule = normalizePromiseSchedule(promise?.schedule)
  const initialDelivery = normalizePromiseDelivery(promise?.delivery)
  const [text, setText] = useState(promise?.text ?? '')
  const [every, setEvery] = useState(initialSchedule.every)
  const [weekday, setWeekday] = useState(initialSchedule.weekday ?? 5)
  const [at, setAt] = useState(initialSchedule.at)
  const [channel, setChannel] = useState(initialDelivery.channel)
  const [to, setTo] = useState(initialDelivery.to)
  const [mode, setMode] = useState(initialDelivery.mode)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const save = async () => {
    const clean = text.trim()
    if (clean === '') {
      setError('说一句到点要做什么')
      return
    }
    const schedule = { every, ...(every === 'week' ? { weekday: Number(weekday) } : {}), at }
    const scheduleProblem = promiseScheduleError(schedule)
    if (scheduleProblem !== '') {
      setError(scheduleProblem)
      return
    }
    const delivery = { channel, to: channel === 'email' ? to.trim() : '', mode }
    const deliveryProblem = promiseDeliveryError(delivery)
    if (deliveryProblem !== '') {
      setError(deliveryProblem)
      return
    }
    setBusy(true)
    setError(null)
    const saved = await onSave({ text: clean, schedule, delivery })
    setBusy(false)
    if (saved === null || saved === undefined || saved.ok === false) {
      setError(saved?.error ?? '没保存上；稍后再试')
      return
    }
    onClose()
  }

  return h('div', {
    className: 'crew-overlay',
    role: 'presentation',
    onClick: event => {
      if (event.target === event.currentTarget && !busy) onClose()
    },
  },
  h('div', {
    className: 'crew-dialog crew-promise-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '改一下说好的事',
    onClick: event => event.stopPropagation(),
  },
  h('div', { className: 'crew-dialog-heading' },
    h('h2', null, '说好的事'),
    h('p', null, '到点做一轮；结果留在房间，或发到邮箱。')),
  h('div', { className: 'crew-dialog-head' },
    h('button', {
      type: 'button',
      className: 'crew-dialog-close',
      'aria-label': '关闭',
      title: '关闭',
      onClick: onClose,
    }, '×')),
  h('div', { className: 'crew-dialog-body crew-promise-form' },
    h('div', { className: 'crew-field' },
      h('label', { className: 'crew-field-label', htmlFor: 'promise-text' }, '做什么'),
      h('textarea', {
        id: 'promise-text',
        className: 'crew-goal-input',
        rows: 3,
        maxLength: 2000,
        autoFocus: true,
        value: text,
        onChange: event => setText(event.target.value),
      })),
    h('div', { className: 'crew-field' },
      h('b', null, '什么时候'),
      h('div', { className: 'crew-promise-when' },
        h('select', {
          className: 'crew-input-narrow',
          value: every,
          'aria-label': '多久一次',
          onChange: event => setEvery(event.target.value),
        }, h('option', { value: 'week' }, '每周'), h('option', { value: 'day' }, '每天')),
        every === 'week'
          ? h('select', {
            className: 'crew-input-narrow',
            value: weekday,
            'aria-label': '星期几',
            onChange: event => setWeekday(event.target.value),
          }, WEEKDAYS.map((name, index) => h('option', { key: name, value: index }, name)))
          : null,
        h('input', {
          className: 'crew-input-narrow',
          type: 'time',
          value: at,
          'aria-label': '几点',
          onChange: event => setAt(event.target.value),
        }))),
    h('div', { className: 'crew-field' },
      h('b', null, '送到哪'),
      h('select', {
        className: 'crew-input-narrow',
        value: channel,
        'aria-label': '送到哪',
        onChange: event => setChannel(event.target.value),
      }, h('option', { value: 'room' }, '留在房间'), h('option', { value: 'email' }, '发到邮箱')),
      channel === 'email'
        ? h('input', {
          className: 'crew-goal-input',
          type: 'email',
          inputMode: 'email',
          placeholder: 'name@example.com',
          value: to,
          'aria-label': '邮箱地址',
          onChange: event => setTo(event.target.value),
        })
        : h('p', { className: 'crew-field-hint' }, '到点开一轮，结果留在时间线里。'),
      channel === 'email'
        ? h('select', {
          className: 'crew-input-narrow',
          value: mode,
          'aria-label': '发送频率',
          onChange: event => setMode(event.target.value),
        }, h('option', { value: 'always' }, '每次都发'), h('option', { value: 'changes' }, '有变化才发'))
        : null),
    error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert' }, error)),
  h('div', { className: 'crew-dialog-foot' },
    h('button', { type: 'button', className: 'crew-ghost', onClick: onClose, disabled: busy }, '取消'),
    h('button', { type: 'button', className: 'crew-accept crew-dialog-primary', onClick: () => void save(), disabled: busy }, busy ? '保存中…' : '保存'))))
}
