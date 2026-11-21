import { createElement as h, useState } from 'react'

// 规划师在人话里用 A. / B. 列出的选择，直接变成可点的按钮；点击后房间继续。
const choiceOptionsOf = text => {
  const source = typeof text === 'string' ? text : ''
  const matches = [...source.matchAll(/(?:^|[：:；;\s])([A-C])[.、:：]\s*([\s\S]*?)(?=(?:[：:；;\s][A-C][.、:：])|$)/g)]
  return matches.slice(0, 3).map(match => {
    const detail = match[2].trim()
    return {
      id: match[1],
      title: detail.split(/[，,；;。。（(]/)[0].slice(0, 36),
      detail,
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
  return h('div', { className: 'crew-human-gate', role: 'group', 'aria-label': '轮到你决定', 'data-room-decision': '' },
    h('div', { className: 'crew-human-gate-head' },
      h('span', { className: 'crew-human-gate-dot', 'aria-hidden': 'true' }),
      h('span', { className: 'crew-human-gate-kicker' }, '待你决定'),
      h('span', { className: 'crew-human-gate-step' }, `第 ${gate.stage + 1} 步`)),
    h('b', { className: 'crew-human-gate-title' }, gate.title),
    h('p', { className: 'crew-human-gate-lead' }, gate.options.length > 0
      ? '选一个方向，或者写下你自己的。'
      : gate.actionRequired || '看看这一步哪里还不够，把要改的写在下面。'),
    gate.options.length === 0
      ? null
      : h('div', { className: 'crew-human-gate-options' },
        gate.options.map(option => h('button', {
          key: option.id,
          type: 'button',
          className: 'crew-human-gate-option',
          disabled: busy,
          onClick: () => void choose(option.action, option.text),
        },
        h('span', { className: 'crew-human-gate-option-key', 'aria-hidden': 'true' }, option.id),
        h('span', { className: 'crew-human-gate-option-copy' },
          h('b', null, option.title))))),
    h('div', { className: 'crew-human-gate-custom' },
      h('textarea', {
        className: 'crew-goal-input crew-human-gate-input',
        rows: 2,
        'aria-label': '补充要改什么',
        placeholder: '或者，写下你想怎么做',
        value: note,
        disabled: busy,
        onChange: event => setNote(event.target.value),
      }),
      error === null ? null : h('p', { className: 'crew-field-hint', role: 'alert', 'data-tone': 'error' }, error),
      h('div', { className: 'crew-human-gate-actions' },
        h('button', {
          type: 'button',
          className: 'crew-accept',
          disabled: busy || note.trim() === '',
          onClick: () => void choose('rework', note),
        }, busy ? '正在继续…' : '按这个继续'))),
    gate.reason === ''
      ? null
      : h('details', { className: 'crew-fold crew-human-gate-why' },
        h('summary', null, '为什么'),
        h('p', null, gate.reason)))
}
