// 外部内容进提示词前只做两件事：去掉不可见控制字符，按字符数截断。
// 零宽、双向覆盖和 C0/C1 控制符可以伪装指令或隐藏内容；预算防止单个工具结果撑爆上下文。
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁠-⁯﻿]/g

export const UNTRUSTED_MAX = 4000

export const sanitizeUntrusted = (text, max = UNTRUSTED_MAX) => {
  const value = String(text ?? '').replace(INVISIBLE, '')
  const limit = Number.isInteger(max) && max > 0 ? max : UNTRUSTED_MAX
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

export const fenceUntrusted = (text, { lang = '', max = UNTRUSTED_MAX } = {}) => {
  const value = sanitizeUntrusted(text, max)
  const longest = Math.max(0, ...(value.match(/`+/g) ?? []).map(run => run.length))
  const fence = '`'.repeat(Math.max(3, longest + 1))
  return `${fence}${lang}\n${value}\n${fence}`
}
