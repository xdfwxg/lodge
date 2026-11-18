import { createElement as h, useState } from 'react'
import { openPath } from '../../system.js'
import { errorSuffix } from '../../error-text.js'

export const mergeConflictOf = room => {
  const conflict = room?.mergeConflict
  if (conflict === null || conflict === undefined) return null
  const path = typeof conflict.path === 'string' && conflict.path !== '' ? conflict.path : room.repoPath
  return {
    stage: Number.isInteger(conflict.stage) ? conflict.stage : null,
    files: Array.isArray(conflict.files) ? conflict.files : [],
    path: typeof path === 'string' ? path : '',
  }
}

export function MergeConflictCard({ room, onResolve = null }) {
  const conflict = mergeConflictOf(room)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)
  if (conflict === null || onResolve === null) return null
  const open = async () => {
    if (conflict.path === '') return
    try {
      setError(null)
      await openPath(conflict.path)
      setNotice('已打开')
      setTimeout(() => setNotice(null), 2000)
    } catch (caught) {
      setError(`没能打开${errorSuffix(caught)}`)
    }
  }
  const resolve = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onResolve()
    setBusy(false)
    if (result?.ok !== true) {
      setError(result?.error ?? '冲突还没解决完')
      return
    }
    setNotice('已继续验收')
  }
  const where = conflict.stage === null ? '这一步' : `第 ${conflict.stage + 1} 步`
  return h('div', {
    className: 'crew-merge-card',
    role: 'group',
    'aria-label': '合并冲突',
    'data-room-decision': '',
  },
  h('b', null, `${where}有合并冲突`),
  h('p', null, conflict.files.length > 0
    ? `冲突文件：${conflict.files.join('、')}。在打开的文件夹里解决并提交，然后点继续。`
    : '在打开的文件夹里解决冲突并提交，然后点继续。'),
  h('div', { className: 'crew-merge-actions' },
    h('button', {
      type: 'button',
      className: 'crew-ghost',
      disabled: conflict.path === '',
      onClick: () => void open(),
    }, '打开冲突文件夹'),
    h('button', {
      type: 'button',
      className: 'crew-accept',
      disabled: busy,
      onClick: () => void resolve(),
    }, busy ? '正在继续…' : '我处理好了，继续')),
  notice === null ? null : h('p', { className: 'crew-field-hint', role: 'status' }, notice),
  error === null ? null : h('p', { className: 'crew-field-hint', role: 'alert' }, error))
}
