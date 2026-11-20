import { createElement as h, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const plugins = [remarkGfm]

function CodeBlock({ children, labels }) {
  const [copied, setCopied] = useState(false)
  const block = useRef(null)
  const copy = () => {
    void navigator.clipboard?.writeText(block.current?.innerText ?? '').then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1000)
    })
  }
  return h('div', { className: 'md-code' },
    h('button', { type: 'button', className: 'md-copy', onClick: copy }, copied ? labels?.code?.copiedLabel : labels?.code?.copyLabel),
    h('pre', { ref: block }, children))
}

// 只有房间里真实存在的成员才做成药丸；@you 这类不是成员，按普通文字显示。
const MENTION = /(@[A-Za-z0-9_\-一-龥]+)/g

const mentionParts = (text, prefix, names) => {
  if (names === null || !text.includes('@')) return [text]
  return text.split(MENTION).map((part, index) => (
    part.startsWith('@') && part.length > 1 && names.has(part.slice(1))
      ? h('span', { key: `${prefix}-${index}`, className: 'crew-mention' }, part)
      : part
  ))
}

const withMentions = (children, names) => (Array.isArray(children) ? children : [children]).flatMap((child, index) => (
  typeof child === 'string' ? mentionParts(child, `mention-${index}`, names) : [child]
))

const elements = (labels, names) => ({
  pre: ({ children }) => h(CodeBlock, { labels }, children),
  p: ({ children }) => h('p', null, withMentions(children, names)),
  li: ({ children }) => h('li', null, withMentions(children, names)),
})

// 系统消息不走 Markdown，但仍要和成员交接一样，把真实的 @ 画成药丸。
export function MentionText({ text, mentions = null }) {
  const names = Array.isArray(mentions) && mentions.length > 0 ? new Set(mentions) : null
  return h('span', null, ...withMentions(String(text ?? ''), names))
}

export function MarkdownText({ text, labels, variant, mentions = null }) {
  const names = Array.isArray(mentions) && mentions.length > 0 ? new Set(mentions) : null
  const signature = names === null ? '' : [...names].join('\u0000')
  const components = useMemo(
    () => elements(labels, names),
    [labels?.code?.copyLabel, labels?.code?.copiedLabel, signature],
  )
  return h('div', { className: variant === 'compact' ? 'md_markdown md-compact' : 'md_markdown' },
    h(Markdown, { remarkPlugins: plugins, components }, text ?? ''))
}
