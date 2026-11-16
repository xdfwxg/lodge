import { Fragment, createElement as h } from 'react'
import { ChatIcon, StudioIcon } from './type-icons.js'

export const ROOM_TYPE_CHOICES = [
  { kind: 'chat', icon: ChatIcon, title: '聊天室' },
  { kind: 'studio', icon: StudioIcon, title: '工作室' },
]

export function RoomTypeChoices({ disabled = false, onPick }) {
  return h(Fragment, null,
    h('p', { className: 'crew-type-note' }, '聊天室、工作室，随时切换。'),
    h('div', { className: 'crew-type-choices' },
      ROOM_TYPE_CHOICES.map(entry => h('button', {
        key: entry.kind,
        type: 'button',
        className: 'crew-type-choice',
        'data-kind': entry.kind,
        disabled,
        onClick: () => onPick(entry.kind),
      },
      h('span', { className: 'crew-type-choice-glyph', 'aria-hidden': 'true' }, h(entry.icon, { size: 22 })),
      h('span', { className: 'crew-type-choice-body' }, h('b', null, entry.title))))))
}
