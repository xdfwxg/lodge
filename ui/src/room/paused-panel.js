import { createElement as h } from 'react'
import { StatePanel } from '../state-panel.js'
import { buildIdleDecision, pausedMemberFixOf } from './decision.js'

// 房间停下时只给一个出口：能修成员就先去修，不能修再继续。
export function PausedPanel({ room, onResume, onFixMember }) {
  const paused = room.state === 'paused' ? buildIdleDecision(room) : null
  if (paused === null) return null
  const fix = pausedMemberFixOf(room)
  return h(StatePanel, {
    key: `paused-${room.id}`,
    title: paused.title,
    body: paused.detail,
    tone: 'paused',
    action: fix === null
      ? h('button', {
        type: 'button',
        className: 'crew-link',
        onClick: onResume,
      }, paused.primary?.label ?? '继续')
      : h('div', { className: 'crew-state-actions' },
        h('button', {
          type: 'button',
          className: 'crew-link',
          onClick: () => onFixMember(fix.memberId),
        }, fix.label),
        h('button', {
          type: 'button',
          className: 'crew-ghost',
          onClick: onResume,
        }, paused.primary?.label ?? '继续')),
  })
}
