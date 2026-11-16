import { createElement as h, useEffect, useRef, useState } from 'react'
import { loginRuntime } from './system.js'

// 登录入口只有这一份：打开终端、等基座刷新、手动登录后的“刷新”都在这里。
export const useEngineLogin = onRefresh => {
  const [busyId, setBusyId] = useState('')
  const [note, setNote] = useState('')
  const timer = useRef(null)

  useEffect(() => () => clearInterval(timer.current), [])

  const reset = () => {
    clearInterval(timer.current)
    setBusyId('')
    setNote('')
  }

  const login = async engine => {
    if (engine === undefined || busyId !== '') return
    setBusyId(engine.id)
    setNote('已打开登录窗口。完成后这里会自动更新。')
    try {
      await loginRuntime(engine.id)
      if (typeof onRefresh === 'function') {
        let tries = 0
        clearInterval(timer.current)
        timer.current = setInterval(async () => {
          tries += 1
          await onRefresh()
          if (tries >= 45) {
            clearInterval(timer.current)
            setNote('还没检测到登录。完成后点“刷新”。')
          }
        }, 2000)
      }
    } catch (error) {
      setNote(String(error?.message ?? error))
    } finally {
      setBusyId('')
    }
  }

  return { busyId, note, login, reset, clearNote: () => setNote('') }
}

export function EngineLogin({ readiness, busyId = '', note = '', disabled = false, onLogin = null, onRefresh = null }) {
  const { loginTargets = [], manualLogin = [] } = readiness ?? {}
  if (loginTargets.length === 0 && manualLogin.length === 0 &&
    (readiness?.canStart === true || (note === '' && onRefresh === null))) return null
  const names = manualLogin.map(item => item.name ?? item.id).join('、')
  return h('div', { className: 'crew-primary-login' },
    loginTargets.map(engine => h('button', {
      key: engine.id,
      type: 'button',
      className: 'crew-ghost',
      disabled: disabled || busyId !== '' || onLogin === null,
      onClick: () => void onLogin?.(engine),
    }, busyId === engine.id ? '正在打开…' : `登录 ${engine.name ?? engine.id}`)),
    onRefresh !== null
      ? h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: disabled,
        onClick: () => void onRefresh(),
      }, '刷新')
      : null,
    manualLogin.length > 0
      ? h('span', { className: 'crew-field-hint' }, `先登录 ${names}。`)
      : null,
    note === '' ? null : h('span', { className: 'crew-field-hint', role: 'status' }, note))
}
