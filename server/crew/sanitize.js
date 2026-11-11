// 公开样本脱敏：只做文本替换，不改变房间结构；替换后仍可被交接包导入。
const RULES = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[私钥已移除]'],
  [/\b(sk-[A-Za-z0-9_-]{12,}|sk-ant-[A-Za-z0-9_-]{12,})\b/g, '[密钥已移除]'],
  [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[令牌已移除]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[令牌已移除]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[密钥已移除]'],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, '[密钥已移除]'],
  [/(api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd)\s*[:=]\s*["']?[^\s"',}]{6,}/gi, (match, key) => `${key}=[已移除]`],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/g, 'Bearer [令牌已移除]'],
  [/\bhttps?:\/\/[^\s/@:]+:[^\s/@]+@/g, 'https://[凭据已移除]@'],
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[邮箱已移除]'],
  [/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"'`]+/g, '[本机路径已移除]'],
  [/(?:\/var\/folders\/|\/private\/var\/|\/private\/tmp\/|\/tmp\/|\/Volumes\/)[^\s"'`]+/g, '[本机路径已移除]'],
]

export const sanitizeText = input => {
  let text = String(input ?? '')
  let count = 0
  for (const [pattern, replacement] of RULES) {
    text = text.replace(pattern, (...args) => {
      count += 1
      return typeof replacement === 'function' ? replacement(...args) : replacement
    })
  }
  return { text, count }
}

const sanitizeValue = (value, stats) => {
  if (typeof value === 'string') {
    const result = sanitizeText(value)
    stats.redactions += result.count
    return result.text
  }
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, stats))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, stats)]))
  }
  return value
}

export const sanitizeHandoff = bundle => {
  const stats = { redactions: 0 }
  const clean = sanitizeValue(structuredClone(bundle), stats)
  return {
    ...clean,
    sanitized: true,
    sanitizeNote: '公开样本：密钥、令牌、邮箱与本机路径已移除。',
    redactionCount: stats.redactions,
  }
}
