import { createElement as h, useId, useRef, useState } from 'react'
import { ArrowUpIcon } from './icons.js'

const mentionAt = (value, cursor) => {
  const before = value.slice(0, cursor)
  const match = before.match(/(^|\s)@([^\s@]*)$/)
  if (match === null) return null
  const start = before.lastIndexOf('@')
  return { start, end: cursor, query: match[2] }
}

function Composer({ placeholder, disabled, onSend, onSent, members = [] }) {
  const [draft, setDraft] = useState('')
  const [mention, setMention] = useState(null)
  const [picked, setPicked] = useState(0)
  const input = useRef(null)
  const listId = useId()

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
    setDraft('')
    setMention(null)
    setPicked(0)
    void onSend(text)
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
        className: 'crew-mentions', id: listId, role: 'listbox', 'aria-label': '选择群成员',
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
        h('span', { className: 'crew-mention-option-name' }, member.name))))
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
