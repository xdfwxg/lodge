// 秘密脱敏：日志、提示词、证据和记忆都从这里过一遍。
// 宁可多遮一层，也不把 token、password 或 .env 的值带进上下文。
const SECRET_KEY = /(?:api[_-]?key|secret|token|password|passwd|pwd|authorization|credential|private[_-]?key)/i
const KEY_VALUE = /((?:api[_-]?key|secret|token|password|passwd|authorization|credential|private[_-]?key)\s*[:=]\s*)(["']?)([^\s"',;]{6,})\2/gi
const TOKEN_PATTERNS = [
  /sk-[A-Za-z0-9_-]{12,}/g,
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi,
]

const redactEnvLine = line => {
  const match = line.match(/^(\s*(?:export\s+)?)([A-Z0-9_]+)(\s*=\s*)(.*)$/)
  if (match === null || !SECRET_KEY.test(match[2])) return line
  return `${match[1]}${match[2]}${match[3]}[redacted]`
}

export const redactSecrets = value => {
  let text = String(value ?? '')
  for (const pattern of TOKEN_PATTERNS) text = text.replace(pattern, '[redacted]')
  text = text.replace(KEY_VALUE, (_, prefix, quote) => `${prefix}${quote}[redacted]${quote}`)
  return text.split('\n').map(redactEnvLine).join('\n')
}
