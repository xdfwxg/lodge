import { createElement as h, useState } from 'react'
import { openPath } from '../../system.js'
import { errorSuffix } from '../../error-text.js'
import { MERGE_STATE, mergeStateOf } from '../../../../shared/merge-state.js'

export const mergeConflictOf = room => {
  const merge = mergeStateOf(room)
  if (merge.state !== MERGE_STATE.CONFLICT) return null
  const conflict = room.mergeConflict
  const path = typeof conflict.path === 'string' && conflict.path !== '' ? conflict.path : room.repoPath
  return {
    stage: Number.isInteger(conflict.stage) ? conflict.stage : null,
    files: merge.files,
    versions: merge.versions,
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
  conflict.versions.length > 0
    ? h('details', { className: 'crew-fold' },
      h('summary', null, '看两边改了什么'),
      ...conflict.versions.map(version => h('div', { key: version.path, className: 'crew-merge-version' },
        h('b', null, version.path),
        ...[
          ['房间当前', version.ours],
          ['成员改动', version.theirs],
          ['共同基准', version.base],
        ].map(([label, text]) => h('div', { key: `${version.path}-${label}`, className: 'crew-merge-version-part' },
          h('span', null, label),
          h('pre', { className: 'crew-code' }, text === '' ? '（这一边没有内容）' : text))))))
    : null,
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
