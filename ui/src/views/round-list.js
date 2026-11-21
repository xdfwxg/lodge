import { createElement as h } from 'react'
import { stripAttachmentTags } from '../../../shared/attachments.js'

export const roundStatusOf = round => {
  if (round?.status === 'completed') return '已交付'
  if (round?.status === 'active') return '进行中'
  if (round?.status === 'planning') return '待决定'
  if (round?.status === 'rejected') return '已退回'
  if (round?.status === 'superseded') return '已作废'
  if (round?.status === 'stopped') return '已停止'
  return '待开始'
}

export const roundNameOf = (round, index) => round?.name || round?.goal || `第 ${index + 1} 轮`

const toneOf = round => (
  round?.status === 'completed' ? 'done'
    : ['rejected', 'superseded', 'stopped'].includes(round?.status) ? 'quiet'
      : 'active'
)

const isOpen = round => round?.status === 'active' || round?.status === 'planning'

export const orderedRounds = rounds => [...(rounds ?? [])].sort((a, b) => (
  (a.ordinal ?? 0) - (b.ordinal ?? 0) || (a.startedAt ?? 0) - (b.startedAt ?? 0)
))

const roundRow = (round, index, onOpenRound) => h('li', {
  key: round.id,
  className: 'crew-project-phase',
  'data-state': toneOf(round),
},
h('button', {
  type: 'button',
  className: 'crew-project-phase-button',
  onClick: () => onOpenRound(round.roomId, isOpen(round) ? null : round.id),
},
h('span', { className: 'crew-project-phase-index', 'aria-hidden': 'true' }, String(round.ordinal ?? index + 1)),
h('span', { className: 'crew-project-phase-copy' },
  h('b', null, roundNameOf(round, index)),
  (() => {
    const goal = stripAttachmentTags(round?.goal ?? '').trim()
    return goal === '' || goal === roundNameOf(round, index) ? null : h('span', null, goal)
  })()),
h('span', { className: 'crew-project-phase-state' }, roundStatusOf(round))))

export const RoundList = ({ rounds = [], onOpenRound, label = '轮次' }) => h('ol', {
  className: 'crew-project-phases',
  'aria-label': label,
}, orderedRounds(rounds).map((round, index) => roundRow(round, index, onOpenRound)))
