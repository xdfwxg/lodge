import { createElement as h, useState } from 'react'
import { ArrowUpIcon } from './icons.js'

function Composer({ placeholder, disabled, onSend }) {
  const [draft, setDraft] = useState('')

  const send = () => {
    const text = draft.trim()
    if (text === '' || disabled) return
    setDraft('')
    void onSend(text)
  }

  return h('div', { className: 'crew-composer' },
    h('textarea', {
      className: 'crew-input',
      rows: 1,
      value: draft,
      placeholder,
      disabled,
      onChange: event => setDraft(event.target.value),
      onKeyDown: event => {
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault()
          send()
        }
      },
    }),
    h('button', { type: 'button', className: 'crew-send', 'aria-label': '发送', disabled: disabled || draft.trim() === '', onClick: send },
      h(ArrowUpIcon)))
}

export { Composer }
