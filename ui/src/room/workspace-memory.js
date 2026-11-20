import { createElement as h, useEffect, useState } from 'react'
import { useOverlay } from '../overlay.js'
import { memoryMetaOf, memoryNotesOf } from './memory-notes.js'

const STATUS = {
  draft: { label: '待审核', tone: 'waiting' },
  approved: { label: '已发布', tone: 'done' },
  rejected: { label: '已拒绝', tone: 'paused' },
}

// 只在选了工作文件夹、且这个文件夹有记忆时出现；不占房间菜单。
export function WorkspaceMemory({ path = '', onLoad = null, onReview = null }) {
  const [entries, setEntries] = useState(null)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(null)
  const [busyId, setBusyId] = useState(null)
  const overlay = useOverlay({
    label: '以前的交付',
    onClose: () => { setOpen(false); setError(null) },
    active: open,
  })
  useEffect(() => {
    if (path === '' || typeof onLoad !== 'function') {
      setEntries([])
      return undefined
    }
    let live = true
    setEntries(null)
    setError(null)
    onLoad(path).then(list => {
      if (live) setEntries(Array.isArray(list) ? list : [])
    }).catch(() => {
      if (live) setEntries([])
    })
    return () => { live = false }
  }, [path])
  if (entries === null || entries.length === 0) return null
  const review = async (entry, decision) => {
    if (busyId !== null) return
    setBusyId(entry.roomId)
    const list = await onReview?.(path, entry.roomId, decision)
    setBusyId(null)
    if (!Array.isArray(list)) {
      setError('没能更新工作区记忆')
      return
    }
    setError(null)
    setEntries(list)
  }
  return h('div', { className: 'crew-workspace-memory' },
    h('p', { className: 'crew-field-hint' },
      `这个文件夹完成过 ${entries.length} 件事`,
      h('button', { type: 'button', className: 'crew-link', onClick: () => setOpen(true) }, '查看')),
    open
      ? h('div', { className: 'crew-overlay', onClick: () => { setOpen(false); setError(null) }, ...overlay },
        h('div', {
          className: 'crew-dialog crew-memory-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': '以前的交付',
          onClick: event => event.stopPropagation(),
        },
        h('div', { className: 'crew-dialog-heading' },
          h('h2', null, '以前的交付'),
          h('p', null, '只读参考；成员不能改，也不参与验收。')),
        h('div', { className: 'crew-dialog-body' },
          error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error),
          h('div', { className: 'crew-memory-list' }, entries.map(entry => h('div', {
            key: entry.roomId,
            className: 'crew-memory-item',
          },
          h('div', { className: 'crew-memory-head' },
            h('b', { className: 'crew-memory-goal' }, entry.goal),
            h('span', {
              className: 'crew-memory-status',
              'data-tone': STATUS[entry.status]?.tone ?? 'waiting',
            }, STATUS[entry.status]?.label ?? '待审核')),
          h('p', { className: 'crew-memory-conclusion' }, entry.conclusion),
          ...memoryNotesOf(entry).map((line, index) => h('p', {
            key: `note-${index}`,
            className: 'crew-memory-note',
            'data-kind': line.kind,
          }, line.text)),
          h('span', { className: 'crew-memory-meta' }, memoryMetaOf(entry)),
          h('div', { className: 'crew-memory-actions' },
            entry.status === 'approved'
              ? null
              : h('button', {
                type: 'button',
                className: 'crew-link',
                disabled: busyId !== null,
                onClick: () => review(entry, 'approve'),
              }, '发布'),
            entry.status === 'rejected'
              ? null
              : h('button', {
                type: 'button',
                className: 'crew-link',
                disabled: busyId !== null,
                onClick: () => review(entry, 'reject'),
              }, '不采用'),
            h('button', {
              type: 'button',
              className: 'crew-link',
              disabled: busyId !== null,
              onClick: () => {
                if (typeof window !== 'undefined' && !window.confirm('删除这条工作区记忆？')) return
                review(entry, 'delete')
              },
            }, '删除')))))),
        h('div', { className: 'crew-dialog-foot' },
          h('button', { type: 'button', className: 'crew-ghost', onClick: () => { setOpen(false); setError(null) } }, '关闭'))))
      : null)
}
