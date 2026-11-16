import { createElement as h } from 'react'
import { ChatIcon, StudioIcon } from './type-icons.js'

export const ROOM_TYPE_CHOICES = [
  {
    kind: 'chat',
    icon: ChatIcon,
    title: '先聊清楚',
    hint: '围绕一个问题讨论，最后收一个结论',
  },
  {
    kind: 'studio',
    icon: StudioIcon,
    title: '直接做出来',
    hint: '说清要交付什么，成员分步完成',
  },
]

export function RoomTypeChoices({ disabled = false, onPick }) {
  return h('div', { className: 'crew-onboarding-choices' },
    ROOM_TYPE_CHOICES.map(entry => h('button', {
      key: entry.kind,
      type: 'button',
      className: 'crew-onboarding-choice',
      'data-kind': entry.kind,
      disabled,
      onClick: () => onPick(entry.kind),
    },
    h('span', { className: 'crew-onboarding-choice-glyph', 'aria-hidden': 'true' }, h(entry.icon, { size: 18 })),
    h('span', { className: 'crew-onboarding-choice-body' },
      h('b', null, entry.title),
      h('span', null, entry.hint)))))
}
