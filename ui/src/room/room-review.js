import { createElement as h } from 'react'

const stateLabel = state => ({
  done: '已定',
  in_progress: '进行中',
  todo: '待办',
  blocked: '卡住',
}[state] ?? state)

export const RoomReview = ({ room }) => {
  const finished = room.state === 'complete' || room.chat?.phase === 'concluded'
  if (!finished) return null
  const issues = (room.issues ?? []).filter(issue => issue.kind !== 'decision').slice(0, 5)
  const items = room.retro?.items ?? []
  if (issues.length === 0 && items.length === 0) return null
  return h('section', { className: 'room-review', 'aria-label': '房间复盘' },
    h('h3', { className: 'room-review-title' }, '房间复盘'),
    items.length === 0 ? null : h('ul', { className: 'room-review-list' },
      items.map(item => h('li', { key: item.kind },
        h('b', null, item.text),
        h('span', null, item.suggestion)))),
    issues.length === 0 ? null : h('ul', { className: 'room-review-issues' },
      issues.map(issue => h('li', { key: issue.id },
        h('span', null, issue.title),
        h('em', null, stateLabel(issue.state))))))
}
