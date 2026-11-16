import { createElement as h } from 'react'

// Gate 是建房前的前置管道：只展示准入结果，不是执行阶段。
export function GateLine({ gate }) {
  if (gate === null || gate === undefined) return null
  const rejected = gate.decision === 'reject'
  if (!rejected) return null
  const issues = Array.isArray(gate.issues) ? gate.issues.map(issue => issue?.text).filter(Boolean) : []
  return h('div', { className: 'crew-system studio-gate-line', 'data-tone': 'reject' }, ['这个房间没能开工', ...issues].join(' · '))
}
