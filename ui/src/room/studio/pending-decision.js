import { Fragment, createElement as h, useState } from 'react'
import { DecisionCard, DecisionOption } from '../decision-card.js'

// 规划师的分叉：一张卡、2–3 条路、每条写清代价，只有用户能选。
export function PendingDecisionCard({ room, onAnswer = null }) {
  const decision = room?.pendingDecision
  const [selected, setSelected] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (decision === null || decision === undefined || decision.status !== 'open') return null
  if (typeof onAnswer !== 'function') return null
  const chosen = selected ?? decision.recommended
  const submit = async optionId => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onAnswer(decision.id, optionId)
    setBusy(false)
    if (result === null || result?.ok === false) setError(result?.error ?? '没能继续，再试一次')
  }
  return h(DecisionCard, {
    kicker: `规划师想请你定${Number.isInteger(decision.stage) ? ` · 第 ${decision.stage + 1} 步` : ''}`,
    title: decision.question,
    lead: '选一条路继续；推荐已经标出来了。',
    roomDecision: true,
    label: '轮到你决定',
    footer: h(Fragment, null,
      h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: busy,
        onClick: () => void submit(chosen),
      }, busy ? '正在继续…' : '按这个继续'),
      h('button', {
        type: 'button',
        className: 'crew-link',
        disabled: busy,
        onClick: () => void submit('cancel'),
      }, '先不做')),
  },
  h('div', { className: 'crew-decision-options', role: 'radiogroup', 'aria-label': '可选方向' },
    decision.options.map(option => h(DecisionOption, {
      key: option.id,
      title: option.title,
      detail: option.effect,
      badge: option.id === decision.recommended ? '推荐' : '',
      selected: chosen === option.id,
      disabled: busy,
      onSelect: () => setSelected(option.id),
    }))),
  error === null ? null : h('p', { className: 'crew-field-hint', role: 'alert', 'data-tone': 'error' }, error))
}
