import { createElement as h, useEffect, useState } from 'react'
import { BotMark } from '../marks.js'
import { changeWordOf, independenceOf } from '../view-format.js'
import { ConfirmationPoints } from './opening-points.js'
import { reworkFloorOf } from './stage-gate.js'

export function ReworkControl({ room, index, onRework, label = '不对，重来' }) {
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
      h('button', { type: 'button', className: 'crew-accept', disabled: busy, onClick: () => void submit() }, busy ? '正在重审…' : '确认重做'),
      h('button', { type: 'button', className: 'crew-ghost', onClick: () => { setOpen(false); setNote('') } }, '取消')))
}

export function FinalSummary({ room }) {
  return h('div', { className: 'crew-final-summary' },
    h('b', null, '整房交付确认'),
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
          ? evidence === undefined ? '无命令证据' : `${evidence.meta.command} · exit ${evidence.meta.exit}`
          : item.state === 'passed' ? '已确认' : '你确认'),
        h('span', null, verdict === undefined ? '' : verdict.meta?.pass === true ? 'PASS' : 'REJECT'))
    }),
    h('p', { className: 'crew-field-hint' }, '确认后写入结论、生成 commit，房间完成。'))
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
    ? '提交回答并继续'
    : next === undefined
      ? '确认完成整房'
      : `确认，进入阶段 ${index + 2}`

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
          h('span', null, `阶段 ${index + 1} / ${room.stages.length}`),
          h('span', { className: 'crew-verdict', 'data-pending': true }, blocked ? '需要你回答' : '需要你确认')),
        h('div', { className: 'crew-card-body' },
          h('p', { className: 'crew-gate-lead' },
            blocked ? 'Lodge 需要你先回答一个问题。' : '需要你确认的是：'),
          h('div', { className: 'crew-gate-title' }, stage.title),
          next === undefined && !blocked ? h(FinalSummary, { room }) : null,
          openingGate ? h(ConfirmationPoints, { room }) : null,
          blocked ? h('p', { className: 'crew-gate-question' }, room.openQuestion) : null,
          blocked
            ? h('textarea', {
              className: 'crew-gate-input',
              rows: 2,
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
                ? '检查上方的产出与文件；确认后进入下一步。'
                : '确认上方的内容；这一步不需要跑命令。'),
          h('p', { className: 'crew-gate-next' },
            next === undefined
              ? '确认后生成结论，完成这次交付。'
              : `确认后进入阶段 ${index + 2}「${next.title}」。`),
          blocked ? null : h('p', { className: 'crew-gate-hint' }, '不同意？在下方直接说，Lodge 会先回答。')),
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

export function DemoStep({ stage, index, onSimulate }) {
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card' },
        h('div', { className: 'crew-card-head' },
          `阶段 ${index + 1}`,
          h('span', { className: 'crew-verdict', 'data-pending': true }, '演示')),
        h('div', { className: 'crew-card-body' },
          h('p', { className: 'crew-muted' },
            `\`${stage.acceptance ?? 'npm test'}\` 还没真实跑过，这一步用模拟数据走完流程。`)),
        h('div', { className: 'crew-card-foot' },
          h('button', { type: 'button', className: 'crew-accept', onClick: onSimulate }, '模拟执行并复核')))))
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
          `阶段 ${index + 1} · 真实验收`,
          h('span', { className: 'crew-verdict', 'data-pending': true },
            evidence === undefined ? '等待证据' : exit !== 0 ? '命令未通过' : rejected ? '验收退回' : '等待复核')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          room.repoPath === null || room.repoPath === undefined
            ? h('p', { className: 'crew-gate-question' }, '房间没有固定工作目录，验收命令不会执行。先给基座群设置工作目录。')
            : null,
          rejected
            ? h('div', { className: 'crew-gate-reject' },
              h('p', null, verdict.text || '验收席位打回了这一步。'),
              h(ReworkControl, { room, index, onRework }))
            : null,
          editing
            ? h('div', { className: 'crew-acceptance-edit' },
              h('p', { className: 'crew-gate-question' }, `验收命令在房间工作区里真实执行；退出码、输出与${changeWordOf(room)}会落成证据。`),
              h('textarea', {
                className: 'crew-gate-input',
                rows: 2,
                value: draft,
                placeholder: '例如：npm test',
                disabled: locked,
                onChange: event => setDraft(event.target.value),
              }))
            : h('div', { className: 'crew-acceptance-row' },
              h('span', { className: 'crew-acceptance-label' }, '验收'),
              h('code', { className: 'crew-acceptance-command' }, savedCommand === '' ? '未设置' : savedCommand),
              !locked
                ? h('button', {
                  type: 'button',
                  className: 'crew-link',
                  onClick: () => setEditing(true),
                }, '改命令')
                : null),
          evidence
            ? h('div', { className: 'crew-receipt' },
              h('code', null, evidence.meta.command),
              h('span', null, `exit ${exit ?? '无'}`),
              (evidence.meta.durationMs ?? 0) >= 100
                ? h('span', null, `${(evidence.meta.durationMs / 1000).toFixed(1)}s`)
                : null)
            : null,
          h('p', { className: 'crew-gate-meta' }, `${hasVerifier ? '有独立验收人' : '没有独立验收人'} · ${independenceOf(room)}`)),
        h('div', { className: 'crew-card-foot' },
          rejected ? null : h(ReworkControl, { room, index, onRework }),
          editing && changed
            ? h('button', {
              type: 'button',
              className: 'crew-ghost',
              disabled: busy || locked,
              onClick: () => void save(),
            }, busy ? '保存中…' : '保存命令')
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
            }, busy ? '等待复核…' : '请求独立复核')
            : null,
          evidence && exit === 0 && !hasVerifier
            ? h('button', {
              type: 'button',
              className: 'crew-accept',
              disabled: locked,
              onClick: () => onAccept(index),
            }, '接受这一阶段')
            : null,
          evidence && exit !== 0
            ? h('span', { className: 'crew-muted' }, '命令未通过：返工后重跑')
            : null))))
}
