import { createElement as h } from 'react'
import { RoundList } from './round-list.js'

// 工作室自己的历史：只列轮次，不引入项目分组。
export function RoomRoundsView({ room, onClose, onOpenRound }) {
  const rounds = room.rounds ?? []
  return h('main', { className: 'dsb-main crew-project' },
    h('div', { className: 'crew-project-inner' },
      h('button', { type: 'button', className: 'crew-link crew-project-back', onClick: onClose }, '← 回到工作室'),
      h('h1', { className: 'crew-project-title' }, '历史'),
      h('p', { className: 'crew-project-count' }, rounds.length === 0 ? '还没有轮次' : `${rounds.length} 轮`),
      rounds.length === 0
        ? h('p', { className: 'crew-field-hint' }, '在工作室里说一句要做什么，就会开出第一轮。')
        : h(RoundList, { rounds, onOpenRound })))
}
