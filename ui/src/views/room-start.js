import { createElement as h, useEffect, useRef, useState } from 'react'
import { loginRuntime } from '../system.js'

// 还没有房间时，直接给一间“新房间”的外壳：只问目标和检查，不再有独立首页。
export function RoomStart({ state, onCreate, onQuickStart, onSample, onRefresh = null }) {
  const [sampleBusy, setSampleBusy] = useState(false)
  const [sampleError, setSampleError] = useState('')
  const [goal, setGoal] = useState('')
  const [check, setCheck] = useState('')
  const [quickBusy, setQuickBusy] = useState(false)
  const [quickError, setQuickError] = useState('')
  const [loginBusy, setLoginBusy] = useState('')
  const [loginNote, setLoginNote] = useState('')
  const timer = useRef(null)
  const engines = state.engines ?? []
  const usable = engines.filter(item => (
    item.available === true && item.authenticated !== false && item.capabilities?.approvalReview === true
  ))
  const installed = engines.filter(item => item.available === true)
  const needsLogin = engines.length > 0 && usable.length === 0
  const loginTargets = installed.filter(item => item.authenticated === false && Array.isArray(item.login?.args))
  const loginManual = installed.filter(item => item.authenticated === false && !Array.isArray(item.login?.args))
  const noGate = installed.filter(item => item.authenticated !== false && item.capabilities?.approvalReview !== true)
  const manualNames = loginManual.map(item => item.name ?? item.id).join('、')
  useEffect(() => () => clearInterval(timer.current), [])
  const watchLogin = () => {
    let tries = 0
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      tries += 1
      await onRefresh?.()
      if (tries >= 45) {
        clearInterval(timer.current)
        setLoginNote('还没检测到登录完成；完成后点“刷新”再试。')
      }
    }, 2000)
  }
  const signIn = async engine => {
    if (loginBusy !== '' || typeof loginRuntime !== 'function') return
    setLoginBusy(engine.id)
    setLoginNote(`已打开 ${engine.name ?? engine.id} 登录终端；登录完成后这里会自动更新。`)
    try {
      await loginRuntime(engine.id)
      watchLogin()
    } catch (error) {
      setLoginNote(String(error?.message ?? error))
    } finally {
      setLoginBusy('')
    }
  }
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
  // 连接状态只在侧栏说一次；这里只说建房页自己的加载失败。
  const errorText = state.phase === 'error' ? `没连上 Lodge：${state.error}` : ''
  return h('main', { className: 'dsb-main crew-room' },
    h('div', { className: 'crew-room-main crew-start-main' },
      h('div', { className: 'crew-start-copy' },
        h('h1', null, '新房间'),
        h('p', null, '一间房，把一件事做完。成员分工，结果可看，检查可查。')),
      needsLogin
        ? h('div', { className: 'crew-start-setup', role: 'status' },
          h('b', null, '还不能开工'),
          h('p', null, installed.length === 0
            ? '还没有可用的模型服务；先安装并登录一家会先问你的模型。'
            : loginTargets.length > 0
              ? '开工前要先登录一个会先问你的模型服务。'
              : loginManual.length > 0
                ? `${manualNames}还没登录。`
                : '已装的模型服务不会逐次确认外部动作，不能用来执行。'),
          loginTargets.map(engine => h('button', {
            key: engine.id,
            type: 'button',
            className: 'crew-ghost',
            disabled: loginBusy !== '',
            onClick: () => void signIn(engine),
          }, loginBusy === engine.id ? '正在打开…' : `登录 ${engine.name ?? engine.id}`)),
          loginManual.length > 0 || (loginTargets.length === 0 && noGate.length === 0 && installed.length > 0)
            ? h('button', {
              type: 'button',
              className: 'crew-ghost',
              disabled: loginBusy !== '' || onRefresh === null,
              onClick: () => void onRefresh?.(),
            }, '刷新')
            : null,
          loginManual.length > 0
            ? h('p', { className: 'crew-field-hint' }, `先在这台电脑上登录 ${manualNames}，完成后点“刷新”。`)
            : null,
          loginNote === '' ? null : h('p', { className: 'crew-field-hint' }, loginNote))
        : null,
      h('form', { className: 'crew-start-form', onSubmit: quickStart },
        h('label', { className: 'crew-start-label', htmlFor: 'room-start-goal' }, '你想让房间做什么？'),
        h('textarea', {
          id: 'room-start-goal',
          className: 'crew-goal-input',
          rows: 2,
          value: goal,
          disabled,
          placeholder: '例如：把这个项目的启动说明补成新人能照着跑的一页。',
          onChange: event => setGoal(event.target.value),
        }),
        h('label', { className: 'crew-start-label', htmlFor: 'room-start-check' }, '做完后跑什么检查？'),
        h('input', {
          id: 'room-start-check',
          className: 'crew-goal-input',
          value: check,
          disabled,
          placeholder: '可选；例如 npm test。不填就由你自己看结果。',
          onChange: event => setCheck(event.target.value),
        }),
        h('button', {
          type: 'submit',
          className: 'crew-start-button',
          disabled: disabled || quickBusy || goal.trim() === '' || needsLogin,
        }, quickBusy ? '开工中…' : '开工')),
      h('div', { className: 'crew-start-secondary' },
        h('button', { type: 'button', className: 'crew-ghost', disabled, onClick: () => onCreate('chat') }, '开一间聊天室'),
        h('button', { type: 'button', className: 'crew-ghost', disabled, onClick: () => onCreate('studio') }, '自定义一间工作室')),
      onSample === undefined
        ? null
        : h('div', { className: 'crew-start-sample' },
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: disabled || sampleBusy,
            onClick: () => void openSample(),
          }, sampleBusy ? '正在打开示例…' : '先看一间完成的示例房间'),
          h('p', { className: 'crew-field-hint' }, '不用配置，直接看结果和工作记录。')),
      quickError === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, quickError),
      sampleError === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, sampleError),
      state.phase === 'loading' ? h('p', { className: 'crew-field-hint', role: 'status' }, '正在连接 Lodge…') : null,
      errorText === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, errorText)))
}
