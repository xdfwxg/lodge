import { createElement as h } from 'react'

const adviceTextOf = advice => advice
  .map(item => item?.summary ?? [...(item?.reasons ?? []), ...(item?.risks ?? [])].join('；'))
  .filter(Boolean)
  .join('；')

// Gate 是建房前的前置管道：只展示准入结果与外部建议，不是执行阶段。
export function GateLine({ gate }) {
  if (gate === null || gate === undefined) return null
  const advice = Array.isArray(gate.advice) ? gate.advice : []
  const rejected = gate.decision === 'reject'
  if (!rejected && advice.length === 0) return null
  const reasons = Array.isArray(gate.reasons) ? gate.reasons : []
  const adviceText = adviceTextOf(advice)
  return h('div', { className: 'crew-system studio-gate-line', 'data-tone': rejected ? 'reject' : 'allow' },
    `Lodge Gate · ${rejected ? '拒绝' : '准入通过'}`,
    reasons.length === 0 ? null : ` · ${reasons.join('；')}`,
    adviceText === '' ? null : ` · 建议：${adviceText}`)
}
