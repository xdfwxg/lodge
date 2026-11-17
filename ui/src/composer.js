import { createElement as h, useEffect, useId, useRef, useState } from 'react'
import { ArrowUpIcon } from './icons.js'
import { BotMark } from './marks.js'

const mentionAt = (value, cursor) => {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|\s)@([^\s@]*)$/)
  if (match === null) return null
  const start = before.lastIndexOf('@')
  return { start, end: cursor, query: match[2] }
}

const draftKeyOf = key => `lodge:draft:${key}`
const readDraft = key => {
  if (key === '') return ''
  try { return globalThis.localStorage?.getItem(draftKeyOf(key)) ?? '' } catch { return '' }
}
const writeDraft = (key, value) => {
  if (key === '') return
  try {
    if (value === '') globalThis.localStorage?.removeItem(draftKeyOf(key))
    else globalThis.localStorage?.setItem(draftKeyOf(key), value)
  } catch {}
}

function Composer({ placeholder, disabled, onSend, onSent, members = [], draftKey = '' }) {
  const [draft, setDraft] = useState(() => readDraft(draftKey))
  const [mention, setMention] = useState(null)
  const [picked, setPicked] = useState(0)
  const input = useRef(null)
  const pickedMentions = useRef([])
  const listId = useId()

  // 每个房间留着自己的草稿，切走再切回来还在。
  useEffect(() => {
    setDraft(readDraft(draftKey))
    setMention(null)
    pickedMentions.current = []
  }, [draftKey])

  const query = mention === null ? '' : mention.query.toLowerCase()
  const matches = mention === null
    ? []
    : members.filter(member => (
      member.mention.toLowerCase().includes(query) ||
      member.name.toLowerCase().includes(query)
    ))

  const change = event => {
    const value = event.target.value
    setDraft(value)
    writeDraft(draftKey, value)
    const next = mentionAt(value, event.target.selectionStart ?? value.length)
    setMention(next)
    setPicked(0)
  }

  const insert = member => {
    if (mention === null) return
    const before = draft.slice(0, mention.start)
    const after = draft.slice(mention.end)
    const token = /\s/.test(member.name) ? member.mention : member.name
    const next = `${before}@${token} ${after}`
    setDraft(next)
    writeDraft(draftKey, next)
    // 记下“挑中的是谁”，发送时带 id，重名也不会送错人。
    if (member.id !== 'all') {
      pickedMentions.current = [
        ...pickedMentions.current.filter(item => item.id !== member.id),
        { id: member.id, token: `@${token}` },
      ]
    }
    setMention(null)
    setPicked(0)
    requestAnimationFrame(() => {
      const at = before.length + token.length + 2
      input.current?.focus()
      input.current?.setSelectionRange(at, at)
    })
  }

  const send = () => {
    const text = draft.trim()
    if (text === '' || disabled) return
    const mentions = pickedMentions.current
      .filter(item => text.includes(item.token))
      .map(item => item.id)
    setDraft('')
    writeDraft(draftKey, '')
    pickedMentions.current = []
    setMention(null)
    setPicked(0)
    void onSend(text, { mentions })
    onSent?.()
    setTimeout(() => onSent?.(), 400)
  }

  const keyDown = event => {
    if (mention !== null && matches.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setPicked(index => (index + 1) % matches.length)
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setPicked(index => (index - 1 + matches.length) % matches.length)
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insert(matches[picked] ?? matches[0])
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  const activeOption = matches[picked] ?? matches[0]

  return h('div', { className: 'crew-composer-wrap' },
    mention !== null && matches.length > 0
      ? h('div', {
        className: 'crew-mentions', id: listId, role: 'listbox', 'aria-label': '选择成员',
      },
        matches.map((member, index) => h('div', {
          key: member.id,
          id: `${listId}-${member.id}`,
          role: 'option',
          'aria-selected': index === picked,
          className: 'crew-mention-option',
          'data-active': index === picked ? 'true' : undefined,
          title: `@${member.mention}`,
          onMouseDown: event => {
            event.preventDefault()
            insert(member)
          },
        },
        h('span', { className: 'crew-mention-avatar', 'aria-hidden': 'true' },
          h(BotMark, { bot: { id: member.id, name: member.name }, size: 24 })),
        h('span', { className: 'crew-mention-copy' },
          h('span', { className: 'crew-mention-option-name' }, member.name),
          member.roleLabel === '' || member.roleLabel === member.name
            ? null
            : h('span', { className: 'crew-mention-role' }, member.roleLabel)),
        index === picked
          ? h('span', { className: 'crew-mention-return', 'aria-hidden': 'true' }, '↵')
          : null)))
      : null,
    h('div', { className: 'crew-composer' },
      h('textarea', {
        ref: input,
        className: 'crew-input',
        rows: 1,
        value: draft,
        placeholder,
        disabled,
        role: 'combobox',
        'aria-label': '房间消息',
        'aria-autocomplete': 'list',
        'aria-expanded': mention !== null && matches.length > 0,
        'aria-controls': mention !== null && matches.length > 0 ? listId : undefined,
        'aria-activedescendant': activeOption === undefined ? undefined : `${listId}-${activeOption.id}`,
        onChange: change,
        onKeyDown: keyDown,
        onBlur: () => setMention(null),
      }),
      h('button', { type: 'button', className: 'crew-send', 'aria-label': '发送', disabled: disabled || draft.trim() === '', onClick: send },
        h(ArrowUpIcon))))
}

export { Composer }
