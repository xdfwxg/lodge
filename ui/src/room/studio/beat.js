import { createElement as h, useEffect, useState } from 'react'
import { Markdown, Speaker } from '../../message-cards.js'

const MAX_BEAT = 180
const HEADING = /^(?:\*\*[^*\n]{1,24}\*\*|[^\n。！？]{1,24}[：:])$/

const cutAt = (text, limit) => {
  const boundary = Math.max(
    text.lastIndexOf('\n', limit),
    text.lastIndexOf('。', limit),
    text.lastIndexOf('；', limit),
  )
  return boundary > limit * 0.6 ? boundary + 1 : limit
}

// 工作拍只露第一段；完整内容留在展开里。工作室消息不是流式的，静态压缩不会跳屏。
export const workBeatOf = (text, limit = MAX_BEAT) => {
  const clean = String(text ?? '').trim()
  if (clean === '') return { preview: '', rest: '' }
  const paragraphs = clean.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean)
  let first = paragraphs[0] ?? ''
  let restParagraphs = paragraphs.slice(1)
  // 「工作日志」这种短标题不单独占一行，要和下面的正文一起出现在预览里。
  if (HEADING.test(first) && restParagraphs.length > 0) {
    first = `${first}\n\n${restParagraphs[0]}`
    restParagraphs = restParagraphs.slice(1)
  }
  if (first.length <= limit) {
    const rest = restParagraphs.join('\n\n').trim()
    return { preview: first, rest }
  }
  const cut = cutAt(first, limit)
  const rest = [
    first.slice(cut).trim(),
    restParagraphs.join('\n\n').trim(),
  ].filter(Boolean).join('\n\n')
  return { preview: first.slice(0, cut).trim(), rest }
}

export function StudioBeat({ message, member, open = false }) {
  const text = String(message.text ?? '').replace(/^\s*(PASS|REJECT)\b[：:\s-]*/i, '')
  const { preview, rest } = workBeatOf(text)
  const [expanded, setExpanded] = useState(open)
  useEffect(() => {
    if (open) setExpanded(true)
  }, [open, message.id])
  return h('div', { className: 'crew-msg crew-msg-chat studio-beat' },
    h('div', { className: 'crew-msg-body' },
      h(Speaker, { member, ts: message.ts, time: false, station: false }),
      h('div', { className: 'bt-bubble' }, h(Markdown, { text: expanded ? text : preview })),
      rest === ''
        ? null
        : h('button', {
          type: 'button',
          className: 'studio-beat-more',
          'aria-expanded': expanded ? 'true' : 'false',
          onClick: () => setExpanded(value => !value),
        }, expanded ? '收起' : `展开全文（${text.length} 字）`)))
}
