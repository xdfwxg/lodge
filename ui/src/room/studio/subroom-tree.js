import { createElement as h, useId, useMemo, useState } from 'react'
import {
  buildSubroomRows,
  canCreateSubroom,
  MAX_SUBROOM_DEPTH,
  subroomStatusOf,
  verdictTextOf,
} from './subroom-model.js'

// 子部门是房间记录里的父子关系：父房只读子房状态和复核结论，不碰子房内部流转。
export function SubroomTree({ room, rooms, onSelect, onCreate }) {
  const [goal, setGoal] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const inputId = useId()
  const rows = useMemo(() => buildSubroomRows(room, rooms), [room, rooms])
  const [expanded, setExpanded] = useState(rows.length > 0)
  const canCreate = canCreateSubroom(room)

  const submit = async () => {
    const text = goal.trim()
    if (busy || text === '') return
    setBusy(true)
    setError('')
    const result = await onCreate(text)
    setBusy(false)
    if (result?.ok === true) {
      setGoal('')
      setCreating(false)
    } else {
      setError(result?.error ?? '创建子部门失败')
    }
  }

  return h('details', {
    className: 'crew-card crew-subrooms',
    open: expanded,
    onToggle: event => setExpanded(event.currentTarget.open),
  },
    h('summary', { className: 'crew-card-head crew-subrooms-head' },
      h('span', { className: 'crew-subrooms-title' }, '子部门'),
      h('span', { className: 'crew-subrooms-count' }, rows.length === 0 ? '还没有' : `${rows.length} 个`)),
    h('div', { className: 'crew-card-body' },
      rows.length === 0
        ? h('span', { className: 'crew-subrooms-empty' }, '父房只看子房的复核结论，不重审子房细节。')
        : h('div', { className: 'crew-subrooms-list' },
          rows.map(row => {
            const reason = typeof row.verdict?.meta?.reason === 'string' ? row.verdict.meta.reason.trim() : ''
            const status = subroomStatusOf(row.room)
            const verdict = verdictTextOf(row.verdict)
            return h('button', {
              key: row.room.id,
              type: 'button',
              className: 'crew-subroom-row',
              style: { paddingLeft: `${12 + row.depth * 18}px` },
              title: row.room.name,
              onClick: () => onSelect(row.room.id),
              'aria-label': `打开子部门 ${row.room.name}，${status}，${verdict}`,
            },
            h('span', { className: 'crew-subroom-body' },
              h('span', { className: 'crew-subroom-name' }, row.room.name),
              reason === '' ? null : h('span', { className: 'crew-subroom-reason' }, reason)),
            h('span', { className: 'crew-subroom-trailing' },
              h('span', { className: 'crew-subroom-meta' }, status),
              h('span', {
                className: 'crew-subroom-verdict',
                'data-verdict': row.verdict === undefined ? 'none' : 'set',
                'data-pass': row.verdict === undefined ? undefined : String(row.verdict.meta?.pass === true),
              }, verdict),
              h('span', { className: 'crew-subroom-chevron', 'aria-hidden': 'true' }, '›')))
          })),
      canCreate
        ? creating
          ? h('div', { className: 'crew-subroom-create' },
            h('label', { className: 'crew-subroom-label', htmlFor: inputId }, '新建子部门'),
            h('div', { className: 'crew-subroom-create-row' },
              h('input', {
                id: inputId,
                type: 'text',
                className: 'crew-subroom-input',
                value: goal,
                placeholder: '描述子部门要完成什么',
                disabled: busy,
                onChange: event => setGoal(event.target.value),
                onKeyDown: event => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  void submit()
                },
              }),
              h('button', {
                type: 'button',
                className: 'crew-accept crew-subroom-submit',
                disabled: busy || goal.trim() === '',
                onClick: () => void submit(),
              }, busy ? '创建中…' : '新建')))
          : h('button', {
            type: 'button',
            className: 'crew-subrooms-add',
            onClick: () => setCreating(true),
          }, '＋ 新建子部门')
        : h('span', { className: 'crew-subrooms-empty' },
          (room.depth ?? 0) >= MAX_SUBROOM_DEPTH ? '已经达到 3 层上限' : '房间完成后不能再新建子部门'),
      error === '' ? null : h('span', { className: 'crew-subrooms-error', role: 'alert' }, error)))
}
