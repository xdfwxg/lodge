import { createElement as h, useEffect, useState } from 'react'
import { BotMark } from '../../marks.js'
import { independenceOf } from '../../view-format.js'
import { ConfirmationPoints } from './opening-points.js'
import { reworkFloorOf } from './stage-gate.js'

function ReworkControl({ room, index, onRework, label = '不对，重来' }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (onRework === undefined || room.state !== 'active') return null
  if (!open) {
    return h('button', { type: 'button', className: 'crew-ghost', onClick: () => setOpen(true) }, label)
  }
  const submit = async () => {
    if (busy) return
    setBusy(true)
    await onRework(index, note.trim())
    setBusy(false)
    setOpen(false)
    setNote('')
  }
  return h('div', { className: 'crew-rework' },
    h('input', {
      className: 'crew-goal-input',
      type: 'text',
      'aria-label': '返工说明（可选）',
      value: note,
      placeholder: '哪里不对？（可选）',
      onChange: event => setNote(event.target.value),
      onKeyDown: event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void submit()
        }
      },
    }),
    h('div', { className: 'crew-rework-actions' },
      h('button', { type: 'button', className: 'crew-accept', disabled: busy, onClick: () => void submit() }, busy ? '正在重做…' : '好，重做'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => { setOpen(false); setNote('') } }, '取消')))
}

function FinalSummary({ room }) {
  return h('div', { className: 'crew-final-summary' },
    h('b', null, '收尾前，再确认一遍'),
    room.stages.map((item, index) => {
      const floor = reworkFloorOf(room.messages, index)
      const evidence = [...room.messages].reverse().find(message => (
        message.kind === 'evidence' &&
        (message.seq ?? 0) > floor &&
        message.meta?.kind === 'command' &&
        (message.meta?.stage ?? 0) === index
      ))
      const verdict = [...room.messages].reverse().find(message => (
        message.kind === 'verdict' && (message.seq ?? 0) > floor && (message.meta?.stage ?? 0) === index
      ))
      return h('div', { key: index, className: 'crew-final-row' },
        h('span', null, `${index + 1}. ${item.title}`),
        h('span', null, item.kind === 'deliverable'
          ? evidence === undefined ? '还没有检查结果' : (evidence.meta.exit === 0 ? '检查通过' : '检查没通过')
          : item.state === 'passed' ? '已确认' : '你确认'),
        h('span', null, verdict === undefined ? '' : verdict.meta?.pass === true ? '通过' : '退回'))
    }),
    h('p', { className: 'crew-field-hint' }, '确认后写下结论，这次交付就结束。'))
}

export function StageAction({ room, stage, index, onAccept, onAnswer, onRework }) {
  const blocked = Boolean(room.openQuestion)
  const locked = room.state !== 'active'
  const next = room.stages[index + 1]
  const openingGate = /确认|对齐/.test(stage.title ?? '') && room.stages.slice(0, index).every(prev => (
    prev.kind === 'decision' && /确认|对齐/.test(prev.title ?? '')
  ))
  const manualWork = stage.manual === true
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const canConfirm = !locked && (!blocked || draft.trim() !== '')
  const actionLabel = blocked
    ? '回答并继续'
    : next === undefined
      ? '可以，收尾'
      : '可以，下一步'

  const confirm = async () => {
    if (!canConfirm || busy) return
    setBusy(true)
    if (blocked) await onAnswer(index, draft.trim())
    else await onAccept(index)
    setBusy(false)
  }

  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate' },
        h('div', { className: 'crew-card-head' },
          h('span', null, `第 ${index + 1} 步 · 共 ${room.stages.length} 步`),
          h('span', { className: 'crew-verdict', 'data-pending': true }, blocked ? '等你回答' : '等你定')),
        h('div', { className: 'crew-card-body' },
          h('p', { className: 'crew-gate-lead' },
            blocked ? '先回答一个问题，我才好继续。' : '这一步要你定：'),
          h('div', { className: 'crew-gate-title' }, stage.title),
          next === undefined && !blocked ? h(FinalSummary, { room }) : null,
          openingGate ? h(ConfirmationPoints, { room }) : null,
          blocked ? h('p', { className: 'crew-gate-question' }, room.openQuestion) : null,
          blocked
            ? h('textarea', {
              className: 'crew-gate-input',
              rows: 2,
              'aria-label': '回答 Lodge 的问题',
              value: draft,
              placeholder: '写下你的决定…',
              onChange: event => setDraft(event.target.value),
              onKeyDown: event => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault()
                  void confirm()
                }
              },
            })
            : h('p', { className: 'crew-gate-question' },
              manualWork
                ? '看看上面的产出和文件，没问题就继续。'
                : '看看上面的内容，没问题就继续。'),
          h('p', { className: 'crew-gate-next' },
            next === undefined
              ? '没问题的话，这次交付就收尾。'
              : `没问题的话，下一步是「${next.title}」。`),
          blocked ? null : h('p', { className: 'crew-gate-hint' }, '哪里不对，直接在下面对我说。')),
        h('div', { className: 'crew-card-foot' },
          stage.manual === true && !blocked
            ? h(ReworkControl, { room, index, onRework })
            : null,
          h('button', {
            type: 'button',
            className: 'crew-accept',
            disabled: !canConfirm || busy,
            onClick: () => void confirm(),
          }, actionLabel)))))
}

export function LiveGate({ room, stage, index, onSetAcceptance, onVerify, onAccept, onRework }) {
  const [draft, setDraft] = useState(stage.acceptance ?? '')
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState(false)
  useEffect(() => {
    setDraft(stage.acceptance ?? '')
    if ((stage.acceptance ?? '').trim() === '') setEditing(true)
  }, [stage.acceptance, index])
  const floor = reworkFloorOf(room.messages, index)
  const savedCommand = typeof stage.acceptance === 'string' ? stage.acceptance.trim() : ''
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' &&
    (message.seq ?? 0) > floor &&
    message.meta?.kind === 'command' &&
    message.meta?.stage === index &&
    message.meta?.command === savedCommand
  ))
  const exit = evidence?.meta?.exit
  const verdict = evidence === undefined
    ? undefined
    : [...room.messages].reverse().find(message => (
      message.kind === 'verdict' &&
      message.meta?.stage === index &&
      message.meta?.evidenceId === evidence.id
    ))
  const rejected = verdict !== undefined && verdict.meta?.pass !== true
  const hasVerifier = (room.verifiers?.length ?? 0) > 0
  const locked = room.state !== 'active'
  const changed = draft.trim() !== (stage.acceptance ?? '')

  const save = async () => {
    if (busy || locked) return
    setBusy(true)
    await onSetAcceptance(index, draft.trim())
    setBusy(false)
    setEditing(false)
  }
  const verify = async () => {
    if (busy || locked) return
    setBusy(true)
    await onVerify(index)
    setBusy(false)
  }

  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate' },
        h('div', { className: 'crew-card-head' },
          `第 ${index + 1} 步 · 检查`,
          h('span', { className: 'crew-verdict', 'data-pending': true },
            evidence === undefined ? '等检查结果' : exit !== 0 ? '检查没通过' : rejected ? '被打回了' : '验收员在看')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          room.repoPath === null || room.repoPath === undefined
            ? h('p', { className: 'crew-gate-question' }, '房间还没有工作文件夹，没法检查。先选一个文件夹。')
            : null,
          rejected
            ? h('div', { className: 'crew-gate-reject' },
              h('p', null, verdict.text || '验收员觉得还不行。'),
              h(ReworkControl, { room, index, onRework }))
            : null,
          editing
            ? h('div', { className: 'crew-acceptance-edit' },
              h('p', { className: 'crew-gate-question' }, '这条检查会在房间的工作区里真的跑一遍，结果会留下来。'),
              h('textarea', {
                className: 'crew-gate-input',
                rows: 2,
                'aria-label': '检查命令',
                value: draft,
                placeholder: '例如：npm test',
                disabled: locked,
                onChange: event => setDraft(event.target.value),
              }))
            : h('div', { className: 'crew-acceptance-row' },
              h('span', { className: 'crew-acceptance-label' }, '检查'),
              h('code', { className: 'crew-acceptance-command', title: savedCommand === '' ? undefined : savedCommand }, savedCommand === '' ? '未设置' : savedCommand),
              !locked
                ? h('button', {
                  type: 'button',
                  className: 'crew-link',
                  onClick: () => setEditing(true),
                }, '改检查')
                : null),
          evidence
            ? h('div', { className: 'crew-receipt' },
              h('span', { 'data-pass': exit === 0 ? 'true' : 'false' }, exit === 0 ? '检查通过' : '检查没通过'),
              (evidence.meta.durationMs ?? 0) >= 100
                ? h('span', null, `${(evidence.meta.durationMs / 1000).toFixed(1)}s`)
                : null)
            : null,
          h('p', { className: 'crew-gate-meta' }, `${hasVerifier ? '有验收员' : '没有验收员'} · ${independenceOf(room)}`)),
        h('div', { className: 'crew-card-foot' },
          rejected ? null : h(ReworkControl, { room, index, onRework }),
          editing && changed
            ? h('button', {
              type: 'button',
              className: 'crew-ghost',
              disabled: busy || locked,
              onClick: () => void save(),
            }, busy ? '保存中…' : '保存检查')
            : null,
          editing && savedCommand !== ''
            ? h('button', {
              type: 'button',
              className: 'crew-ghost',
              onClick: () => {
                setDraft(stage.acceptance ?? '')
                setEditing(false)
              },
            }, '取消')
            : null,
          evidence && exit === 0 && hasVerifier && !rejected
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: busy || locked,
              onClick: () => void verify(),
            }, busy ? '等验收员看…' : '请验收员复核')
            : null,
          evidence && exit === 0 && !hasVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: locked,
              onClick: () => onAccept(index),
            }, '通过这一步')
            : null,
          evidence && exit !== 0
            ? h('span', { className: 'crew-muted' }, '检查没通过：返工后重试')
            : null))))
}
