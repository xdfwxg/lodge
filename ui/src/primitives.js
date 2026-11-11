// The window's own versions of the DSH interface primitives the Bot views draw with.
import { createElement as h, useMemo, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MENTION_ORIGIN } from './dsbot/client/text.js'

export const FishLogo = () => null

export const writeClipboard = text => (navigator.clipboard === undefined
  ? Promise.resolve(document.execCommand('copy', false, text))
  : navigator.clipboard.writeText(text).then(() => true, () => false))

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
  a: ({ node: _node, ...props }) => h('a', props.href?.startsWith(MENTION_ORIGIN) ? props : { ...props, target: '_blank', rel: 'noreferrer' }),
  pre: ({ children }) => h(CodeBlock, { labels }, children),
})

export function MarkdownText({ text, labels, variant }) {
  const components = useMemo(() => elements(labels), [labels?.code?.copyLabel, labels?.code?.copiedLabel])
  return h('div', { className: variant === 'compact' ? 'md_markdown md-compact' : 'md_markdown' },
    h(Markdown, { remarkPlugins: plugins, components }, text ?? ''))
}
