import { Fragment, createElement as h, useState } from 'react'
import { DecisionCard, DecisionOption } from '../decision-card.js'

// 规划师在人话里用 A. / B. 列出的选择，直接变成可点的按钮；点击后房间继续。
const choiceOptionsOf = text => {
  const source = typeof text === 'string' ? text : ''
  const matches = [...source.matchAll(/(?:^|[：:；;\s])([A-C])[.、:：]\s*([\s\S]*?)(?=(?:[：:；;\s][A-C][.、:：])|$)/g)]
  return matches.slice(0, 3).map(match => {
    const detail = match[2].trim()
    const title = detail.split(/[，,；;。。（(]/)[0].slice(0, 36)
    const cost = detail.startsWith(title)
      ? detail.slice(title.length).replace(/^[，,；;。：:\s]+/, '')
      : detail
    return {
      id: match[1],
      title,
      detail: cost,
      action: /^(接受|收下|认可|同意)/.test(detail) ? 'accept' : 'rework',
      text: `${match[1]}. ${detail}`,
    }
  })
}

// 规划师把这一步交给人以后，界面要给出一个明确动作，而不是只剩输入框。
export const humanGateOf = room => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const index = stages.findIndex(stage => stage.state === 'active')
  if (index < 0 || room?.state !== 'active') return null
  const decision = room.lastPlannerDecision
  if (decision?.stage !== index || decision?.kind !== 'human') return null
  const messages = Array.isArray(room.messages) ? room.messages : []
  const latest = [...messages].reverse()
    .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === index)
  if (latest === undefined || (latest.id ?? latest.seq) !== decision.verdictId) return null
  const judgment = decision.judgment ?? {}
  const actionRequired = typeof judgment.actionRequired === 'string' ? judgment.actionRequired : ''
  return {
    stage: index,
    title: stages[index].title ?? '',
    reason: typeof judgment.reason === 'string' ? judgment.reason : '',
    actionRequired,
    options: choiceOptionsOf(actionRequired),
  }
}

export function HumanGateCard({ room, onChoose = null, onRework = null }) {
  const gate = humanGateOf(room)
  const [note, setNote] = useState('')
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (gate === null || (onChoose === null && onRework === null)) return null
  const choose = async (action, text) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = onChoose === null
      ? await onRework(gate.stage, text)
      : await onChoose(gate.stage, action, text)
    setBusy(false)
    if (result === null) {
      setError('没能继续，再试一次')
      return
    }
    setNote('')
  }
  const chosen = gate.options.find(option => option.id === selected) ?? null
  const canSubmit = busy === false && (chosen !== null || note.trim() !== '')
  const submit = () => {
    if (!canSubmit) return
    void choose(chosen === null ? 'rework' : chosen.action, chosen === null ? note : chosen.text)
  }
  return h(Fragment, null,
    h(DecisionCard, {
      kicker: `待你决定 · 第 ${gate.stage + 1} 步`,
      title: gate.title,
      lead: gate.options.length > 0
        ? '选一个方向，或者写下你自己的。'
        : gate.actionRequired || '看看这一步哪里还不够，把要改的写在下面。',
      roomDecision: true,
      label: '轮到你决定',
      footer: h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: !canSubmit,
        onClick: submit,
      }, busy ? '正在继续…' : '按这个继续'),
    },
    gate.options.length === 0
      ? null
      : h('div', { className: 'crew-decision-options', role: 'radiogroup', 'aria-label': '可选方向' },
        gate.options.map(option => h(DecisionOption, {
          key: option.id,
          title: option.title,
          detail: option.detail,
          selected: selected === option.id,
          disabled: busy,
          onSelect: () => {
            setSelected(option.id)
            setNote('')
          },
        }))),
    h('div', { className: 'crew-decision-input' },
      h('textarea', {
        className: 'crew-goal-input',
        rows: 2,
        'aria-label': '补充要改什么',
        placeholder: '或者，写下你想怎么做',
        value: note,
        disabled: busy,
        onChange: event => {
          setNote(event.target.value)
          setSelected(null)
        },
      }),
      error === null ? null : h('p', { className: 'crew-field-hint', role: 'alert', 'data-tone': 'error' }, error)),
    gate.reason === ''
      ? null
      : h('details', { className: 'crew-fold crew-decision-why' },
        h('summary', null, '为什么'),
        h('p', null, gate.reason))))
}
