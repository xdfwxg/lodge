// 这一轮的“做到什么算完成”：可观察结果、边界、非目标和关键假设。
// 契约只写标准，不写验收方法；验收方法仍归验收员。
const CONTRACT_VERSION = 1

const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
const list = (value, max, each) => (
  Array.isArray(value) ? value.map(each).filter(Boolean).slice(0, max) : []
)

const idOf = (value, index) => {
  const raw = text(value, 40).toLowerCase()
  const slug = raw.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  return slug === '' ? `o${index + 1}` : slug
}

export const normalizeContract = value => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const outcomes = []
  const used = new Set()
  for (const [index, item] of (Array.isArray(value.outcomes) ? value.outcomes : []).entries()) {
    if (item === null || typeof item !== 'object') continue
    const statement = text(item.statement, 300)
    const observable = text(item.observable, 300)
    if (statement === '' || observable === '') continue
    let id = idOf(item.id, index)
    while (used.has(id)) id = `${id}-${index + 1}`
    used.add(id)
    outcomes.push({ id, statement, observable })
    if (outcomes.length >= 6) break
  }
  if (outcomes.length === 0) return null
  return {
    version: CONTRACT_VERSION,
    outcomes,
    boundaries: list(value.boundaries, 6, item => text(item, 300)).filter(Boolean),
    nonGoals: list(value.nonGoals, 6, item => text(item, 300)).filter(Boolean),
    assumptions: list(value.assumptions, 6, item => text(item, 300)).filter(Boolean),
  }
}
