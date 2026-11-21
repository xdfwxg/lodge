import { createElement as h } from 'react'

export const reviewItemsOf = room => (room?.retro?.items ?? [])
  .filter(item => item !== null && item !== undefined && typeof item.text === 'string' && item.text.trim() !== '')

const reviewList = items => h('ul', { className: 'room-review-list' },
  items.map(item => h('li', { key: item.kind },
    h('b', null, item.text),
    h('span', null, item.suggestion))))

export const RoomReview = ({ room, finished, collapsible = false }) => {
  if (!finished) return null
  const items = reviewItemsOf(room)
  if (items.length === 0) return null
  if (collapsible) {
    return h('details', { className: 'room-review', 'aria-label': '房间复盘' },
      h('summary', { className: 'room-review-title' }, '房间复盘'),
      reviewList(items))
  }
  return h('section', { className: 'room-review', 'aria-label': '房间复盘' },
    h('h3', { className: 'room-review-title' }, '房间复盘'),
    reviewList(items))
}
