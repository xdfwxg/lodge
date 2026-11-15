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
  const issues = Array.isArray(gate.issues) ? gate.issues.map(issue => issue?.text).filter(Boolean) : []
  const adviceText = adviceTextOf(advice)
  const text = rejected
    ? ['这个房间没能开工', ...issues].join(' · ')
    : `Lodge 的建议：${adviceText}`
  return h('div', { className: 'crew-system studio-gate-line', 'data-tone': rejected ? 'reject' : 'allow' }, text)
}
