import { redactSecrets } from '../../shared/secrets.js'

const clean = value => {
  if (typeof value === 'string') return redactSecrets(value)
  if (value instanceof Error) return new Error(redactSecrets(value.message))
  return value
}

// 开发者日志也走同一套脱敏；人可见的时间线仍由 systemNotice 控制。
export const warn = (...args) => console.warn(...args.map(clean))
export const error = (...args) => console.error(...args.map(clean))
export const info = (...args) => console.log(...args.map(clean))
