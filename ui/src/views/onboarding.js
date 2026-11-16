import { createElement as h, useState } from 'react'

export function Onboarding({ state, archived = [], onRestore, onCreate, onQuickStart, onSample }) {
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const [goal, setGoal] = useState('')
  const [check, setCheck] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickError, setQuickError] = useState('')
  const disabled = state.phase === 'loading' || state.phase === 'error'
  const openSample = async () => {
    if (sampleBusy || typeof onSample !== 'function') return
    setSampleBusy(true)
    setSampleError('')
    const result = await onSample()
    setSampleBusy(false)
    if (result?.ok !== true) setSampleError(result?.error ?? '示例房间没能打开')
  }
  const quickStart = async event => {
    event.preventDefault()
    const text = goal.trim()
    if (text === '' || quickBusy || typeof onQuickStart !== 'function') return
    setQuickBusy(true)
    setQuickError('')
    try {
      const result = await onQuickStart(text, check.trim())
      if (result?.ok !== true) setQuickError(result?.error ?? '房间没能建起来')
    } catch (error) {
      setQuickError(String(error?.message ?? error))
    } finally {
      setQuickBusy(false)
    }
  }
  const errorText = state.runtime?.ok === false
    ? `Lodge 服务未连接：${state.runtime.error}`
    : state.phase === 'error'
      ? `没连上 Lodge：${state.error}`
      : ''
  return h('div', { className: 'crew-onboarding' },
    h('div', { className: 'crew-onboarding-card' },
      h('img', { className: 'crew-onboarding-logo', src: './logo.svg', alt: 'Lodge', width: 96, height: 96 }),
      h('h1', null, 'Lodge'),
      h('p', null, '一间房，把一件事做完。成员分工，结果可看，检查可查。'),
      h('form', { className: 'crew-onboarding-quick', onSubmit: quickStart },
        h('label', { className: 'crew-onboarding-quick-label', htmlFor: 'quick-goal' }, '你想让房间做什么？'),
        h('textarea', {
          id: 'quick-goal',
          className: 'crew-goal-input',
          rows: 2,
          value: goal,
          disabled,
          placeholder: '例如：把这个项目的启动说明补成新人能照着跑的一页。',
          onChange: event => setGoal(event.target.value),
        }),
        h('label', { className: 'crew-onboarding-quick-label', htmlFor: 'quick-check' }, '做完后跑什么检查？'),
        h('input', {
          id: 'quick-check',
          className: 'crew-goal-input',
          value: check,
          disabled,
          placeholder: '可选；例如 npm test。不填就由你自己看结果。',
          onChange: event => setCheck(event.target.value),
        }),
        h('button', {
          type: 'submit',
          className: 'crew-onboarding-start',
          disabled: disabled || quickBusy || goal.trim() === '',
        }, quickBusy ? '开工中…' : '开工')),
      h('div', { className: 'crew-onboarding-secondary' },
        h('button', { type: 'button', className: 'crew-ghost', disabled, onClick: () => onCreate('chat') }, '开一间聊天室'),
        h('button', { type: 'button', className: 'crew-ghost', disabled, onClick: () => onCreate('studio') }, '自定义一间工作室')),
      quickError === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, quickError),
      onSample === undefined
        ? null
        : h('div', { className: 'crew-onboarding-sample' },
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: disabled || sampleBusy,
            onClick: () => void openSample(),
          }, sampleBusy ? '正在打开示例…' : '先看一间完成的示例房间'),
          h('p', { className: 'crew-field-hint' }, '不用配置，直接看结果和工作记录。')),
      sampleError === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, sampleError),
      archived.length === 0 || typeof onRestore !== 'function'
        ? null
        : h('div', { className: 'crew-onboarding-archived' },
          h('p', { className: 'crew-field-hint' }, '已归档的房间'),
          ...archived.map(room => h('button', {
            key: room.id,
            type: 'button',
            className: 'crew-ghost',
            onClick: () => void onRestore(room.id),
          }, `恢复「${room.name}」`))),
      state.phase === 'loading' ? h('p', { className: 'crew-field-hint', role: 'status' }, '正在连接 Lodge…') : null,
      errorText === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, errorText)))
}
