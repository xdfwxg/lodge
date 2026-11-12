import { createElement as h, useEffect, useMemo, useState } from 'react'
import { BotMark } from '../marks.js'
import { ApprovalCard } from '../approval-card.js'
import { Markdown, ActivityLine, ChatLine, EvidenceCard, VerdictCard, DispatchCard, StageConclusionCard, ConclusionCard } from '../message-cards.js'
import { changeWordOf, independenceOf } from '../view-format.js'

const confirmationItems = room => (room.brief?.constraints ?? [])
  .filter(line => typeof line === 'string' && line.startsWith('已确认：'))
  .slice(0, 3)
  .map(line => {
    const text = line.replace(/^已确认：/, '')
    const [question, ...rest] = text.split('→')
    const answer = rest.join('→').trim()
    const label = /源文件|哪一个|哪个文件/.test(question)
      ? '源文件'
      : /改动|调整|方向/.test(question)
        ? '改动方向'
        : /交付物|尺寸|放到哪里/.test(question)
          ? '交付物'
          : null
    return { question: question.trim(), answer, label }
  })

function ConfirmationPoints({ room }) {
  const items = confirmationItems(room)
  if (items.length === 0) return null
  return h('div', null,
    h('p', { className: 'crew-gate-points-label' }, '已对齐的内容：'),
    h('ul', { className: 'crew-gate-points' },
      items.map((item, at) => h('li', { key: `confirm-${at}` },
        item.label === null ? null : h('span', { className: 'crew-gate-point-label' }, item.label),
        h('span', { className: 'crew-gate-point-question' }, item.question),
        item.answer === '' ? null : h('b', { className: 'crew-gate-point-answer' }, item.answer)))))
}

function ConfirmedOpening({ room, stage, index }) {
  const next = room.stages[index + 1]
  if (confirmationItems(room).length === 0) return null
  return h('div', { className: 'crew-msg' },
    h('div', { className: 'crew-msg-avatar' }, h(BotMark, { size: 30, live: false })),
    h('div', { className: 'crew-msg-body' },
      h('div', { className: 'crew-card crew-human-gate crew-gate-done' },
        h('div', { className: 'crew-card-head' },
          h('span', null, `阶段 ${index + 1} / ${room.stages.length}`),
          h('span', { className: 'crew-verdict', 'data-pass': true }, '已确认')),
        h('div', { className: 'crew-card-body' },
          h('p', { className: 'crew-gate-lead' }, '开工卡已确认：'),
          h('div', { className: 'crew-gate-title' }, stage.title),
          h(ConfirmationPoints, { room }),
          h('p', { className: 'crew-gate-next' },
            next === undefined
              ? '已确认，等待交付。'
              : `已进入阶段 ${index + 2}「${next.title}」。`)))))
}

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

// 人的返工意见之后，这一阶段的旧证据和旧结论不再算数。
const reworkFloorOf = (messages, stageIndex) => messages.reduce((floor, message) => (
  message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex ? Math.max(floor, message.seq ?? 0) : floor
), -1)

function FinalSummary({ room }) {
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

function StageAction({ room, stage, index, onAccept, onAnswer, onRework }) {
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

function DemoStep({ stage, index, onSimulate }) {
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

function LiveGate({ room, stage, index, onSetAcceptance, onVerify, onAccept, onRework }) {
  const [draft, setDraft] = useState(stage.acceptance ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => { setDraft(stage.acceptance ?? '') }, [stage.acceptance])
  const floor = reworkFloorOf(room.messages, index)
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' && (message.seq ?? 0) > floor && message.meta?.kind === 'command' && message.meta?.stage === index
  ))
  const exit = evidence?.meta?.exit
  const hasVerifier = (room.verifiers?.length ?? 0) > 0
  const locked = room.state !== 'active'
  const changed = draft.trim() !== (stage.acceptance ?? '')

  const save = async () => {
    if (busy || locked) return
    setBusy(true)
    await onSetAcceptance(index, draft.trim())
    setBusy(false)
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
          h('span', { className: 'crew-verdict', 'data-pending': true }, exit === 0 ? '等待复核' : '等待命令')),
        h('div', { className: 'crew-card-body' },
          h('div', { className: 'crew-gate-title' }, stage.title),
          h('p', { className: 'crew-gate-question' },
            room.repoPath
              ? `验收命令在房间工作区里真实执行；退出码、输出与${changeWordOf(room)}会落成证据。`
              : '房间没有固定工作目录，验收命令不会执行。先给基座群设置工作目录。'),
          h('textarea', {
            className: 'crew-gate-input',
            rows: 2,
            value: draft,
            placeholder: '例如：npm test',
            disabled: locked,
            onChange: event => setDraft(event.target.value),
          }),
          evidence
            ? h('div', { className: 'crew-receipt' },
              h('code', null, evidence.meta.command),
              h('span', null, `exit ${exit ?? '无'}`),
              h('span', null, `${((evidence.meta.durationMs ?? 0) / 1000).toFixed(1)}s`))
            : null,
          h('p', { className: 'crew-dialog-note' }, `${hasVerifier ? '有独立验收人' : '没有独立验收人'} · ${independenceOf(room)}`)),
        h('div', { className: 'crew-card-foot' },
          h(ReworkControl, { room, index, onRework }),
          h('button', {
            type: 'button',
            className: 'crew-ghost',
            disabled: busy || locked || !changed,
            onClick: () => void save(),
          }, '保存命令'),
          evidence && exit === 0 && hasVerifier
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

function Timeline({ room, seats, onAccept, onAnswer, onSimulate, onSetAcceptance, onVerify, onApproval, onRework }) {
  const byId = useMemo(() => Object.fromEntries(seats.map(seat => [seat.id, seat])), [seats])
  const activeIndex = room.stages.findIndex(stage => stage.state === 'active')
  const activeStage = room.stages[activeIndex]
  const floor = reworkFloorOf(room.messages, activeIndex)
  const hasPass = activeIndex >= 0 && room.messages.some(message => (
    message.kind === 'verdict' && (message.seq ?? 0) > floor && message.meta?.pass === true && message.meta?.stage === activeIndex
  ))
  const manualReady = activeStage?.manual === true && room.messages.some(message => (
    message.kind === 'evidence' && (message.seq ?? 0) > floor && message.meta?.kind === 'manual' && (message.meta?.stage ?? 0) === activeIndex
  ))
  const firstDeliverable = room.stages.findIndex(stage => stage.kind === 'deliverable')
  const opening = room.stages
    .map((stage, index) => ({ stage, index }))
    .filter(({ stage, index }) => (
      stage.state === 'passed' &&
      stage.kind === 'decision' &&
      /确认|对齐/.test(stage.title ?? '') &&
      (firstDeliverable < 0 || index < firstDeliverable)
    ))
    .at(-1)

  return [
    ...room.messages.map(message => {
      const seat = byId[message.authorId] ?? (message.authorId === 'system' ? { name: '运行时', title: '验收员' } : undefined)
      if (message.kind === 'system') return h('div', { key: message.id, className: 'crew-system' }, message.text)
      if (message.kind === 'dispatch') return h(DispatchCard, { key: message.id, message, seat })
      if (message.kind === 'stage_conclusion') return h(StageConclusionCard, { key: message.id, message })
      if (message.kind === 'activity') return h(ActivityLine, { key: message.id, message })
      if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
      if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
      if (message.kind === 'verdict') {
        return h(VerdictCard, {
          key: message.id,
          message,
          seat,
          room,
          stage: room.stages[message.meta?.stage ?? 0],
          onAccept,
        })
      }
      if (message.authorId === 'you') {
        return h('div', { key: message.id, className: 'crew-human' },
          h('div', { className: 'bt-ububble' }, h(Markdown, { text: message.text, variant: 'compact' })))
      }
      return h(ChatLine, { key: message.id, message, seat })
    }),
    ...(room.approvals ?? [])
      .filter(approval => approval.state === 'pending')
      .map(approval => h(ApprovalCard, {
        key: approval.id,
        approval,
        onDecide: decision => onApproval(approval.id, decision),
      })),
    opening === undefined ? null : h(ConfirmedOpening, {
      key: 'opening-confirmed',
      room,
      stage: opening.stage,
      index: opening.index,
    }),
    activeStage?.kind === 'decision' && (activeStage.manual !== true || manualReady)
      ? h(StageAction, { key: 'gate', room, stage: activeStage, index: activeIndex, onAccept, onAnswer, onRework })
      : null,
    activeStage?.kind === 'deliverable' && room.live === true && !hasPass
      ? h(LiveGate, { key: 'live-gate', room, stage: activeStage, index: activeIndex, onSetAcceptance, onVerify, onAccept, onRework })
      : null,
    activeStage?.kind === 'deliverable' && room.demo === true && !hasPass
      ? h(DemoStep, { key: 'demo', stage: activeStage, index: activeIndex, onSimulate })
      : null,
  ].filter(Boolean)
}

export { Timeline }
