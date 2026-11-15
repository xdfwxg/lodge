import assert from 'node:assert/strict'
import test from 'node:test'
import { orderRooms, roomLabelOf } from './sidebar.js'

test('sidebar room labels carry name, status, unread and needs-you text', () => {
  assert.equal(roomLabelOf({ name: '简历', state: 'active', live: true }), '简历，正在做')
  assert.equal(
    roomLabelOf({ name: '简历', state: 'active', needsYou: { kind: 'review', label: '验收员在看' }, chatUnread: true }),
    '简历，验收员在看，有新消息',
  )
  assert.equal(roomLabelOf({ name: '周报', state: 'complete' }), '周报，已完成')
  assert.equal(roomLabelOf({ name: '空房', state: 'paused' }), '空房，已暂停')
  assert.equal(roomLabelOf({ name: '旧房', state: 'complete', archivedAt: 1 }), '旧房，已归档')
})


test('rooms are ordered by attention, recency and completion', () => {
  const rooms = [
    { id: 'done', state: 'complete', messages: [{ ts: 1 }] },
    { id: 'recent-old', state: 'active', live: true, messages: [{ ts: 2 }] },
    { id: 'pending', state: 'active', needsYou: { kind: 'decision' }, messages: [{ ts: 3 }] },
    { id: 'recent-new', state: 'active', live: true, messages: [{ ts: 4 }] },
    { id: 'archived', state: 'stopped', archivedAt: 5, needsYou: { kind: 'decision' }, messages: [{ ts: 5 }] },
  ]
  assert.deepEqual(orderRooms(rooms).map(room => room.id), [
    'pending', 'recent-new', 'recent-old', 'done', 'archived',
  ])
})
