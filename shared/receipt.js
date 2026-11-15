// 工作室 → 聊天室的回执契约：只带结果、完成度、检查与开放问题。
const LIST_LIMIT = 6
const ITEM_LIMIT = 300
const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')
const listOf = value => (
  Array.isArray(value) ? value.map(clean).filter(Boolean).slice(0, LIST_LIMIT) : []
)

export const normalizeReceipt = value => {
  if (value === null || typeof value !== 'object') return null
  const receipt = {
    result: clean(value.result).slice(0, ITEM_LIMIT),
    completeness: clean(value.completeness).slice(0, 120),
    checks: listOf(value.checks),
    openQuestions: listOf(value.openQuestions),
  }
  const empty = receipt.result === '' &&
    receipt.completeness === '' &&
    receipt.checks.length === 0 &&
    receipt.openQuestions.length === 0
  return empty ? null : receipt
}

export const receiptText = receipt => {
  const normalized = normalizeReceipt(receipt)
  if (normalized === null) return ''
  const lines = []
  if (normalized.result !== '') lines.push(`结果：${normalized.result}`)
  if (normalized.completeness !== '') lines.push(`完成度：${normalized.completeness}`)
  if (normalized.checks.length > 0) lines.push(`检查：${normalized.checks.join('；')}`)
  if (normalized.openQuestions.length > 0) lines.push(`待确认：${normalized.openQuestions.join('；')}`)
  return lines.join('\n')
}
