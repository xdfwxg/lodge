import { createElement as h, useState } from 'react'
import {
  normalizePromiseDelivery,
  normalizePromiseSchedule,
  promiseDeliveryError,
  promiseScheduleError,
  promiseScheduleText,
} from '../../../shared/promise.js'
import { Segmented } from '../segmented.js'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const CHANNELS = [{ value: 'room', label: '留在房间' }, { value: 'email', label: '发到邮箱' }]
const MODES = [{ value: 'always', label: '每次都发' }, { value: 'changes', label: '有变化才发' }]

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

  const summary = /^([01]\d|2[0-3]):[0-5]\d$/.test(at)
    ? `${promiseScheduleText({ every, ...(every === 'week' ? { weekday: Number(weekday) } : {}), at })} · ${channel === 'email' ? '发到邮箱' : '留在房间'}`
    : ''

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
    h('p', null, '到点开一轮，结果留在房间或发到邮箱。')),
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
      h('label', { className: 'crew-promise-label', htmlFor: 'promise-text' }, '做什么'),
      h('textarea', {
        id: 'promise-text',
        className: 'crew-goal-input',
        rows: 3,
        maxLength: 2000,
        autoFocus: true,
        value: text,
        onChange: event => setText(event.target.value),
      })),
    h('div', { className: 'crew-field', role: 'group', 'aria-label': '什么时候' },
      h('span', { className: 'crew-promise-label' }, '什么时候'),
      h('div', { className: 'crew-promise-when-row' },
        h('select', {
          className: 'crew-promise-control',
          value: every,
          'aria-label': '多久一次',
          onChange: event => setEvery(event.target.value),
        }, h('option', { value: 'week' }, '每周'), h('option', { value: 'day' }, '每天')),
        every === 'week'
          ? h('select', {
            className: 'crew-promise-control',
            value: weekday,
            'aria-label': '星期几',
            onChange: event => setWeekday(event.target.value),
          }, WEEKDAYS.map((name, index) => h('option', { key: name, value: index }, name)))
          : null,
        h('input', {
          className: 'crew-promise-control',
          type: 'time',
          value: at,
          'aria-label': '几点',
          onChange: event => setAt(event.target.value),
        }))),
    h('div', { className: 'crew-field', role: 'group', 'aria-label': '送到哪' },
      h('span', { className: 'crew-promise-label' }, '送到哪'),
      h(Segmented, {
        label: '送到哪',
        options: CHANNELS,
        value: channel,
        onChange: setChannel,
      }),
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
        : null,
      channel === 'email'
        ? h(Segmented, {
          label: '发送频率',
          options: MODES,
          value: mode,
          onChange: setMode,
        })
        : null),
    error === null ? null : h('p', { className: 'crew-dialog-note', 'data-tone': 'error', role: 'alert' }, error)),
  h('div', { className: 'crew-dialog-foot' },
    summary === '' ? null : h('p', { className: 'crew-dialog-foot-hint' }, summary),
    h('button', { type: 'button', className: 'crew-ghost', onClick: onClose, disabled: busy }, '取消'),
    h('button', { type: 'button', className: 'crew-accept crew-dialog-primary', onClick: () => void save(), disabled: busy }, busy ? '保存中…' : '保存'))))
}
