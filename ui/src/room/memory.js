import { createElement as h, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { dateTimeOf } from '../view-format.js'

const short = value => (typeof value === 'string' && value.length > 12 ? value.slice(0, 12) : value)

const entryMeta = entry => [
  entry.completedAt === undefined || entry.completedAt === null ? '' : dateTimeOf(entry.completedAt),
  Array.isArray(entry.stages) && entry.stages.length > 0 ? `${entry.stages.length} 步` : '',
  Array.isArray(entry.files) && entry.files.length > 0 ? `${entry.files.length} 个文件` : '',
  entry.commit === null || entry.commit === undefined ? '' : short(entry.commit),
  entry.verdict === null || entry.verdict === undefined ? '' : (entry.verdict.pass === true ? '通过' : '退回'),
].filter(Boolean).join(' · ')

export function RoomMemory({ room, onLoad }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState(null)
  const [error, setError] = useState(null)
  const overlay = useOverlay({
    label: '房间记忆',
    onClose: () => { setOpen(false); setError(null) },
    active: open,
  })
  if (room.demo === true) return null
  const openDialog = async () => {
    setOpen(true)
    setError(null)
    setEntries(null)
    const list = await onLoad()
    if (list === null) {
      setError('没能读取房间记忆')
      return
    }
    setEntries(list)
  }
  return h('div', { className: 'crew-room-memory' },
    h('button', { type: 'button', className: 'crew-link', onClick: openDialog }, '房间记忆'),
    open
      ? h('div', { className: 'crew-overlay', onClick: () => { setOpen(false); setError(null) }, ...overlay },
        h('div', {
          className: 'crew-dialog crew-memory-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '房间记忆',
          onClick: event => event.stopPropagation(),
        },
        h('div', { className: 'crew-dialog-heading' },
          h('h2', null, '房间记忆'),
          h('p', null, '只读试点 · 只汇总这个工作区已交付的房间，不进入提示词或验收。')),
        h('div', { className: 'crew-dialog-body' },
          error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error),
          entries === null && error === null
            ? h('p', { className: 'crew-dialog-note' }, '正在读取…')
            : entries !== null && entries.length === 0
              ? h('p', { className: 'crew-dialog-note' }, '这个工作区还没有已交付的房间。')
              : h('div', { className: 'crew-memory-list' }, (entries ?? []).map(entry => h('div', {
                key: entry.roomId,
                className: 'crew-memory-item',
              },
              h('b', { className: 'crew-memory-goal' }, entry.goal),
              h('p', { className: 'crew-memory-conclusion' }, entry.conclusion),
              h('span', { className: 'crew-memory-meta' }, entryMeta(entry)))))),
        h('div', { className: 'crew-dialog-foot' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => { setOpen(false); setError(null) } }, '关闭'))))
      : null)
}
