import { createElement as h } from 'react'

const CODE = /`([^`\n]+)`/g

// 方案文本里的 `命令` 和文件名按行内代码渲染；未闭合的反引号原样保留。
export const inlineCode = text => {
  const source = typeof text === 'string' ? text : ''
  const parts = []
  let last = 0
  for (const match of source.matchAll(CODE)) {
    if (match.index > last) parts.push(source.slice(last, match.index))
    parts.push(h('code', { key: `code-${match.index}`, className: 'crew-inline-code' }, match[1]))
    last = match.index + match[0].length
  }
  if (last < source.length) parts.push(source.slice(last))
  return parts
}
