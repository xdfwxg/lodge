import { Fragment, createElement as h, useState } from 'react'
import { useOverlay } from '../../overlay.js'

const isWorkStage = stage => stage.kind === 'deliverable' || stage.manual === true

export const workStagesOf = room => (room?.stages ?? [])
  .map((stage, index) => ({ ...stage, index }))
  .filter(isWorkStage)

// 人工门可以从任意非 pending 节点重开；决策节点重开后由规划师重新说明或由人重新确认。
export const adjustableStagesOf = room => (room?.stages ?? [])
  .map((stage, index) => ({ ...stage, index }))
  .filter(stage => stage.state !== 'pending')

export const rewindActionLabel = state => (state === 'active' ? '补一句再跑' : '退回并重跑')

const stateLabel = stage => (
  stage.state === 'passed' ? '已通过' : stage.state === 'active' ? '进行中' : '未开始'
)

// 调整步骤：当前步骤是“补一句再跑”，已通过的步骤是“退回并重跑”。
function StageRewindDialog({ room, busy = false, error = null, onCancel, onConfirm }) {
  const stages = adjustableStagesOf(room)
  const active = stages.find(stage => stage.state === 'active')
  const lastPassed = [...stages].reverse().find(stage => stage.state === 'passed')
  const [selected, setSelected] = useState(active?.index ?? lastPassed?.index ?? stages[0]?.index ?? -1)
  const [note, setNote] = useState('')
  const overlay = useOverlay({ label: '调整步骤', onClose: busy ? () => {} : onCancel, active: true })
  const target = room.stages?.[selected]
  const inPlace = target?.state === 'active'
  return h('div', { className: 'crew-overlay', onClick: busy ? undefined : onCancel, ...overlay },
    h('div', {
      className: 'crew-dialog crew-rewind',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-label': '调整步骤',
      onClick: event => event.stopPropagation(),
    },
    h('div', { className: 'crew-dialog-heading' },
      h('h2', null, '调整步骤')),
    h('div', { className: 'crew-dialog-body' },
      h('div', { className: 'crew-rewind-steps', role: 'radiogroup', 'aria-label': '选择步骤' },
        stages.map(stage => h('button', {
          key: stage.index,
          type: 'button',
          role: 'radio',
          'aria-checked': selected === stage.index,
          className: 'crew-rewind-step',
          'data-active': selected === stage.index ? 'true' : undefined,
          disabled: busy || stage.state === 'pending',
          onClick: () => setSelected(stage.index),
        },
        h('span', { className: 'crew-rewind-index' }, `${stage.index + 1}`),
        h('span', { className: 'crew-rewind-title' }, stage.title),
        h('span', { className: 'crew-rewind-state' }, stateLabel(stage))))),
      h('label', { className: 'crew-field' },
        h('b', null, inPlace ? '要补的上下文' : '为什么要退回'),
        h('textarea', {
          className: 'crew-mind-raw',
          rows: 4,
          value: note,
          disabled: busy,
          placeholder: inPlace
            ? '补一句背景、约束或要改的点，然后重跑这一步。'
            : '写清要改什么；退回后，后面的步骤会重新来过。',
          onChange: event => setNote(event.target.value),
        })),
      error === null ? null : h('p', { className: 'crew-dialog-note', role: 'alert', 'data-tone': 'error' }, error)),
    h('div', { className: 'crew-dialog-foot' },
      h('button', { type: 'button', className: 'crew-ghost', disabled: busy, onClick: onCancel }, '取消'),
      h('button', {
        type: 'button',
        className: 'crew-accept crew-dialog-primary',
        disabled: busy || note.trim() === '' || target === undefined,
        onClick: () => onConfirm({ stage: selected, note: note.trim() }),
      }, busy ? '正在处理…' : rewindActionLabel(target?.state)))))
}

// 房间里的常驻入口：只在连着的活动房间里出现；已交付房间用同一句话“调整某一步”。
export function StudioAdjust({ room, onRewind }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const stages = (room.stages ?? []).filter(stage => stage.state !== 'pending')
  if (room.state !== 'active' || room.live !== true || stages.length === 0) return null
  const finished = (room.stages ?? []).length > 0 && room.stages.every(stage => stage.state === 'passed')
  return h(Fragment, null,
    h('div', { className: 'crew-room-adjust' },
      h('button', {
        type: 'button',
        className: 'crew-link',
        onClick: () => {
          setError(null)
          setOpen(true)
        },
      }, finished ? '调整某一步' : '调整步骤')),
    open
      ? h(StageRewindDialog, {
        room,
        busy,
        error,
        onCancel: () => {
          if (!busy) setOpen(false)
        },
        onConfirm: async ({ stage, note }) => {
          setBusy(true)
          setError(null)
          const result = await onRewind(stage, note)
          setBusy(false)
          if (result === null) {
            setError('没能退回；看房间顶部的提示。')
            return
          }
          setOpen(false)
        },
      })
      : null)
}
