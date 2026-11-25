// 规划师提案里的成员 id / 名字，由这一处映射到真实执行官。
// 验收与规划成员不由提案派发；未知 token 直接丢弃。
const MAX_ASSIGNEES = 8

const isExecutor = member => member?.role === 'worker' || member?.roleKind === 'executor'

export const resolveAssigneeTokens = (tokens, roster) => {
  if (!Array.isArray(tokens) || tokens.length === 0) return []
  const byToken = new Map()
  for (const member of roster) {
    byToken.set(member.id, member)
    byToken.set(member.name, member)
  }
  const resolved = []
  for (const token of tokens) {
    const raw = typeof token === 'string' ? token.trim() : ''
    if (raw === '') continue
    const member = byToken.get(raw)
    if (isExecutor(member)) resolved.push(member.id)
  }
  return [...new Set(resolved)].slice(0, MAX_ASSIGNEES)
}
