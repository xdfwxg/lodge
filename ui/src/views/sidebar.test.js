import assert from 'node:assert/strict'
import test from 'node:test'
import { filterRooms, orderRooms, roomLabelOf } from './sidebar.js'

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


test('room search matches name, goal and status text', () => {
  const rooms = [
    { id: 'a', name: '发布检查', goal: '把清单做成可勾选的一页', state: 'active', live: true },
    { id: 'b', name: '周会讨论', goal: '把周会压到二十分钟', state: 'complete' },
    { id: 'c', name: '简历', state: 'active', needsYou: { kind: 'signoff', label: '待签字' } },
  ]
  assert.deepEqual(filterRooms(rooms, '发布').map(room => room.id), ['a'])
  assert.deepEqual(filterRooms(rooms, '周会').map(room => room.id), ['b'])
  assert.deepEqual(filterRooms(rooms, '待签字').map(room => room.id), ['c'])
  assert.deepEqual(filterRooms(rooms, '  ').map(room => room.id), ['a', 'b', 'c'])
  assert.deepEqual(filterRooms(rooms, '不存在'), [])
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
