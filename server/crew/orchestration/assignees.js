// 规划师提案里的席位 id / 名字，由这一处映射到真实执行席位。
// 验收与规划席位不由提案派发；未知 token 直接丢弃。
const MAX_ASSIGNEES = 8

export const resolveAssigneeTokens = (tokens, roster) => {
  if (!Array.isArray(tokens) || tokens.length === 0) return []
  const byToken = new Map()
  for (const seat of roster) {
    byToken.set(seat.id, seat)
    byToken.set(seat.name, seat)
  }
  const resolved = []
  for (const token of tokens) {
    const raw = typeof token === 'string' ? token.trim() : ''
    if (raw === '') continue
    const seat = byToken.get(raw)
    if (seat?.role === 'worker') resolved.push(seat.id)
  }
  return [...new Set(resolved)].slice(0, MAX_ASSIGNEES)
}
