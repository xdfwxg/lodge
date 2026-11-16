import { Fragment, createElement as h } from 'react'
import { ChatIcon, StudioIcon } from './type-icons.js'

export const ROOM_TYPE_CHOICES = [
  {
    kind: 'chat',
    icon: ChatIcon,
    title: '先聊清楚',
    hint: '聊出结论，再交给工作室',
  },
  {
    kind: 'studio',
    icon: StudioIcon,
    title: '直接做出来',
    hint: '成员分步做出来，结果可查',
  },
]

export function RoomTypeChoices({ disabled = false, onPick }) {
  return h(Fragment, null,
    h('div', { className: 'crew-type-choices' },
      ROOM_TYPE_CHOICES.map(entry => h('button', {
        key: entry.kind,
        type: 'button',
        className: 'crew-type-choice',
        'data-kind': entry.kind,
        disabled,
        onClick: () => onPick(entry.kind),
      },
      h('span', { className: 'crew-type-choice-glyph', 'aria-hidden': 'true' }, h(entry.icon, { size: 20 })),
      h('span', { className: 'crew-type-choice-body' },
        h('b', null, entry.title),
        h('span', null, entry.hint))))),
    h('p', { className: 'crew-type-note' }, '两间房可以互相转交：聊清楚再开工，或者做完回到讨论。'))
}
