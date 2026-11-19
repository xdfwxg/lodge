import { createElement as h, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { presenceLines } from './studio/transcript-model.js'

// 一间房只有一个紧急刹车；只在真的有回合在跑时出现，点之前说清后果。
export function StopRoom({ room, members = [], onStop = null }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const overlay = useOverlay({ label: '停下这一轮', onClose: () => setOpen(false), active: open })
  const { working, queued } = presenceLines(room, members)
  const running = working.length > 0 || queued.length > 0
  if (onStop === null || room?.state !== 'active' || room?.live !== true || !running) return null
  const stop = async () => {
    setBusy(true)
    setNote('')
    const result = await onStop()
    setBusy(false)
    if (result?.ok === false) {
      setNote(result.error ?? '没能停下')
      return
    }
    setOpen(false)
  }
  return h('div', { className: 'crew-stop-room' },
    h('button', {
      type: 'button',
      className: 'crew-link',
      'aria-label': '停下这一轮',
      onClick: () => {
        setNote('')
        setOpen(true)
      },
    }, '停下'),
    open
      ? h('div', { className: 'crew-overlay', onClick: busy ? undefined : () => setOpen(false), ...overlay },
        h('div', {
          className: 'crew-dialog crew-stop-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '停下这一轮',
          onClick: event => event.stopPropagation(),
        },
        h('div', { className: 'crew-dialog-heading' },
          h('h2', null, '停下这一轮？'),
          h('p', null, '已产出的内容保留；之后可以点继续。')),
        note === '' ? null : h('p', { className: 'crew-dialog-note', role: 'alert' }, note),
        h('div', { className: 'crew-dialog-foot' },
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: busy,
            autoFocus: true,
            onClick: () => setOpen(false),
          }, '继续跑'),
          h('button', {
            type: 'button',
            className: 'crew-accept crew-dialog-primary',
            'data-danger': 'true',
            disabled: busy,
            onClick: () => void stop(),
          }, busy ? '正在停…' : '停下'))))
      : null)
}
