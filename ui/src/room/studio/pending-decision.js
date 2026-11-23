import { Fragment, createElement as h, useState } from 'react'
import { DecisionCard, DecisionOption } from '../decision-card.js'

// 规划师的分叉：一张卡、2–3 条路、每条写清代价，只有用户能选。
export function PendingDecisionCard({ room, onAnswer = null }) {
  const decision = room?.pendingDecision
  const [selected, setSelected] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (decision === null || decision === undefined || decision.status !== 'open') return null
  if (typeof onAnswer !== 'function') return null
  const chosen = selected ?? decision.recommended
  // 没点过任何选项时，按钮提交的是推荐项；按钮要把这件事说出来。
  const usingDefault = selected === null && decision.recommended !== undefined
  // 卡上的路都不合适时，用户自己写一句；这句就是他要的方向。
  const isOther = chosen === 'other'
  const written = note.trim()
  const submit = async (optionId, text = '') => {
    if (busy) return
    setBusy(true)
    setError(null)
    const result = await onAnswer(decision.id, optionId, text)
    setBusy(false)
    if (result === null || result?.ok === false) setError(result?.error ?? '没能继续，再试一次')
  }
  // 问的人是规划师本人：卡头直接用他的头像和名字，而不是一行灰字。
  const lead = (room?.members ?? []).find(member => member.role === 'lead') ?? null
  return h(DecisionCard, {
    kicker: `想请你定${Number.isInteger(decision.stage) ? ` · 第 ${decision.stage + 1} 步` : ''}`,
    title: decision.question,
    speaker: lead,
    roomDecision: true,
    label: '轮到你决定',
    // 取消在左、主操作在右；取消是中性按钮，整张卡只有一个蓝色动作。
    footer: h(Fragment, null,
      h('button', {
        type: 'button',
        className: 'crew-ghost',
        disabled: busy,
        onClick: () => void submit('cancel'),
      }, '先不做这一步'),
      h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: busy || chosen === undefined || (isOther && written === ''),
        onClick: () => void submit(chosen, isOther ? written : ''),
      }, busy ? '正在继续…' : isOther ? '按我写的继续' : usingDefault ? '按推荐继续' : '按这个继续')),
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
    })),
    // 其他：一行里写完；选中后输入框就长在这一行，不再另占一块。
    h('div', {
      key: 'other',
      className: 'crew-decision-option crew-decision-other',
      role: 'radio',
      'aria-checked': isOther,
      'data-on': isOther ? 'true' : undefined,
      tabIndex: busy ? undefined : 0,
      onClick: () => { if (!busy && !isOther) setSelected('other') },
      onKeyDown: event => {
        if (busy || isOther) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setSelected('other')
        }
      },
    },
    h('span', { className: 'crew-decision-radio', 'aria-hidden': 'true' }),
    h('span', { className: 'crew-decision-copy crew-decision-other-copy' },
      h('span', { className: 'crew-decision-option-title' }, '其他'),
      isOther
        ? h('input', {
          type: 'text',
          className: 'crew-decision-note',
          value: note,
          placeholder: '写下你想怎么做…',
          'aria-label': '其他做法',
          autoFocus: true,
          disabled: busy,
          onClick: event => event.stopPropagation(),
          onChange: event => setNote(event.target.value),
          onKeyDown: event => {
            if (event.key !== 'Enter' || written === '') return
            event.preventDefault()
            void submit('other', written)
          },
        })
        : null))),
  error === null ? null : h('p', { className: 'crew-field-hint', role: 'alert', 'data-tone': 'error' }, error))
}
