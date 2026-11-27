import { createElement as h, useEffect, useRef, useState } from 'react'

// 外部事件入口：给房间开一个地址，别的系统往这里发一句话，就会作为一条消息进房间。
// 地址里带着房间的钥匙；换地址等于作废旧地址，关掉就整条路消失。
export const fullLinkOf = path => {
  if (typeof path !== 'string' || path === '') return ''
  const origin = typeof globalThis.location?.origin === 'string' ? globalThis.location.origin : ''
  return origin === '' || origin === 'null' ? path : `${origin}${path}`
}

export function EventLinkDialog({ room, onAction, onClose }) {
  const [on, setOn] = useState(room?.webhook?.enabled === true)
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState(null)

  const run = async action => {
    setBusy(true)
    setError(null)
    const result = await onAction(action)
    setBusy(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '没连上；稍后再试')
      return null
    }
    setOn(result.enabled === true)
    setLink(result.enabled === true ? fullLinkOf(result.path) : '')
    return result
  }

  // 开着的时候取回现在的地址：开启是幂等的，不会把地址换掉。
  useEffect(() => {
    if (on) void run('enable')
  }, [])

  const copy = async () => {
    if (link === '') return
    try {
      await globalThis.navigator?.clipboard?.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setError('没能复制；选中地址手动复制。')
    }
  }

  const close = () => { if (!busy) onClose() }
  const dialogRef = useRef(null)
  useEffect(() => { dialogRef.current?.focus?.({ preventScroll: true }) }, [])

  return h('div', {
    className: 'crew-overlay',
    role: 'presentation',
    onClick: event => { if (event.target === event.currentTarget) close() },
  },
  h('div', {
    ref: dialogRef,
    className: 'crew-dialog crew-event-dialog',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': '外部事件',
    tabIndex: -1,
    onKeyDown: event => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close()
    },
    onClick: event => event.stopPropagation(),
  },
  h('div', { className: 'crew-dialog-heading' },
    h('h2', null, '外部事件'),
    h('p', null, '把地址填到会发通知的系统里，发来的消息会进这个房间。')),
  h('div', { className: 'crew-dialog-head' },
    h('button', {
      type: 'button',
      className: 'crew-dialog-close',
      'aria-label': '关闭',
      title: '关闭',
      onClick: close,
    }, '×')),
  h('div', { className: 'crew-dialog-body' },
    !on
      ? h('p', { className: 'crew-dialog-sub' }, '还没开启。开启后会得到一行地址。')
      : link === ''
        ? h('p', { className: 'crew-dialog-sub' }, '正在取地址…')
        : h('input', {
          className: 'crew-promise-control crew-event-link',
          readOnly: true,
          value: link,
          'aria-label': '外部事件地址',
          onFocus: event => event.target.select(),
        }),
    error === null ? null : h('p', { className: 'crew-dialog-note', 'data-tone': 'error', role: 'alert' }, error)),
  h('div', { className: 'crew-dialog-foot' },
    on
      ? h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: busy,
        onClick: async () => {
          const result = await run('disable')
          if (result !== null) onClose()
        },
      }, '关掉')
      : null,
    on
      ? h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: busy,
        onClick: () => void run('rotate'),
      }, '换一个地址')
      : null,
    !on
      ? h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy,
        onClick: () => void run('enable'),
      }, busy ? '开启中…' : '开启')
      : h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy || link === '',
        onClick: () => void copy(),
      }, copied ? '已复制' : '复制地址'))))
}
