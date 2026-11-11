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

const elements = labels => ({
  pre: ({ children }) => h(CodeBlock, { labels }, children),
})

export function MarkdownText({ text, labels, variant }) {
  const components = useMemo(() => elements(labels), [labels?.code?.copyLabel, labels?.code?.copiedLabel])
  return h('div', { className: variant === 'compact' ? 'md_markdown md-compact' : 'md_markdown' },
    h(Markdown, { remarkPlugins: plugins, components }, text ?? ''))
}
