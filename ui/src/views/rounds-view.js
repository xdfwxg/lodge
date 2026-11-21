import { createElement as h } from 'react'
import { RoundList } from './round-list.js'

// 工作室自己的历史：先看轮次，再决定要不要进项目分组。
export function RoomRoundsView({ room, onClose, onOpenRound, onOpenProject = null }) {
  const rounds = room.rounds ?? []
  const projectId = room.workRound?.projectId ?? room.defaultProjectId ?? null
  return h('main', { className: 'dsb-main crew-project' },
    h('div', { className: 'crew-project-inner' },
      h('button', { type: 'button', className: 'crew-link crew-project-back', onClick: onClose }, '← 回到工作室'),
      h('div', { className: 'crew-project-history-head' },
        h('p', { className: 'crew-project-kicker' }, room.name || '工作室'),
        projectId !== null && typeof onOpenProject === 'function'
          ? h('button', {
            type: 'button',
            className: 'crew-link',
            onClick: () => onOpenProject(projectId),
          }, '项目')
          : null),
      h('h1', { className: 'crew-project-title' }, '历史'),
      h('p', { className: 'crew-project-count' }, rounds.length === 0 ? '还没有轮次' : `${rounds.length} 轮`),
      rounds.length === 0
        ? h('p', { className: 'crew-field-hint' }, '在工作室里说一句要做什么，就会开出第一轮。')
        : h(RoundList, { rounds, onOpenRound })))
}
