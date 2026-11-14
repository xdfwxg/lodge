import { createElement as h } from 'react'
import { ChatIcon, StudioIcon } from './type-icons.js'

export const ROOM_TYPE_CHOICES = [
  {
    kind: 'chat',
    icon: ChatIcon,
    title: '开个聊天室',
    hint: '围绕一个话题聊，主持人收敛结论',
  },
  {
    kind: 'studio',
    icon: StudioIcon,
    title: '开个工作室',
    hint: '给目标和验收，按阶段交付',
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
