import { createElement as h, useState } from 'react'
import { DecisionCard } from '../decision-card.js'
import { needsAction } from '../../needs.js'

// 人工确认的落点：岛上的“去处理”必须能滚到一张真的能按的卡。
export function StageConfirmCard({ room, onAccept = null }) {
  const needs = needsAction(room)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (needs?.kind !== 'confirm' || typeof onAccept !== 'function') return null
  const index = Number.isInteger(needs.stage)
    ? needs.stage
    : (room.stages ?? []).findIndex(stage => stage.state === 'active')
  const stage = index < 0 ? undefined : room.stages?.[index]
  if (stage === undefined) return null
  const confirm = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onAccept(index)
    setBusy(false)
    if (result === null || result?.ok === false || typeof result?.error === 'string') {
      setError(result?.error ?? '没能继续，再试一次')
    }
  }
  return h(DecisionCard, {
    kicker: `待你确认 · 第 ${index + 1} 步`,
    title: stage.title ?? '这一步',
    lead: needs.detail || '结果已经好了；确认后继续。',
    roomDecision: true,
    label: '轮到你确认',
    footer: h('button', {
      type: 'button',
      className: 'crew-accept',
      disabled: busy,
      onClick: () => void confirm(),
    }, busy ? '正在继续…' : '确认这一步'),
  }, error === null ? null : h('p', { className: 'crew-field-hint', role: 'alert', 'data-tone': 'error' }, error))
}
