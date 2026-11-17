import { createElement as h } from 'react'
import { ExecutorIcon, PersonIcon, PlannerIcon, VerifierIcon } from '../icons.js'

const kindOf = member => {
  const role = member?.roleKind ?? member?.role ?? ''
  if (role === 'lead' || role === 'planner') return 'planner'
  if (role === 'verifier') return 'verifier'
  if (role === 'worker' || role === 'executor') return 'executor'
  return 'member'
}

// 每个成员面前放一个角色图标，名字才是人名的补充，不是唯一标识。
export function RoleIcon({ member, className = 'crew-role-icon' }) {
  const kind = kindOf(member)
  const Icon = kind === 'planner'
    ? PlannerIcon
    : kind === 'verifier' ? VerifierIcon : kind === 'executor' ? ExecutorIcon : PersonIcon
  return h('span', { className, 'data-kind': kind, 'aria-hidden': 'true' }, h(Icon))
}
