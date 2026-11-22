import assert from 'node:assert/strict'
import test from 'node:test'
import { filterRooms, orderRooms, roomLabelOf, roomStampOf } from './room-list.js'

test('sidebar room labels carry name, status, unread and needs-you text', () => {
  assert.equal(roomLabelOf({ name: '简历', state: 'active', live: true }), '简历，进行中')
  assert.equal(
    roomLabelOf({ name: '简历', state: 'active', needsYou: { kind: 'review', label: '验收员在看' }, chatUnread: true }),
    '简历，验收员在看，有新消息',
  )
  assert.equal(roomLabelOf({ name: '周报', state: 'idle', workRound: { id: 'round-1', status: 'completed' } }), '周报，已交付')
  assert.equal(roomLabelOf({ name: '聊天', state: 'active', chat: { phase: 'concluded' }, modeCapabilities: { stages: false } }), '聊天，聊到这儿了')
  assert.equal(roomLabelOf({ name: '空房', state: 'paused' }), '空房，已暂停')
  assert.equal(roomLabelOf({ name: '旧房', state: 'idle', archivedAt: 1 }), '旧房，已归档')
})


test('room search matches name, goal and status text', () => {
  const rooms = [
    { id: 'a', name: '发布检查', goal: '把清单做成可勾选的一页', state: 'active', live: true },
    { id: 'b', name: '周会讨论', goal: '把周会压到二十分钟', state: 'idle', workRound: { id: 'round-1', status: 'completed' } },
    { id: 'c', name: '简历', state: 'active', needsYou: { kind: 'signoff', label: '待确认' } },
  ]
  assert.deepEqual(filterRooms(rooms, '发布').map(room => room.id), ['a'])
  assert.deepEqual(filterRooms(rooms, '周会').map(room => room.id), ['b'])
  assert.deepEqual(filterRooms(rooms, '待确认').map(room => room.id), ['c'])
  assert.deepEqual(filterRooms(rooms, '  ').map(room => room.id), ['a', 'b', 'c'])
  assert.deepEqual(filterRooms(rooms, '不存在'), [])
})

test('only duplicate room names get a time stamp', () => {
  const room = { id: 'a', name: '评测', messages: [{ ts: new Date(2026, 10, 20, 9, 5).getTime() }] }
  assert.equal(roomStampOf([room, { id: 'b', name: '周报' }], room), '')
  assert.equal(roomStampOf([room, { id: 'b', name: '评测' }], room), '11/20 09:05')
  assert.equal(roomStampOf([room, { id: 'b', name: '评测', archivedAt: 1 }], room), '')
})

test('rooms are ordered by attention, recency and completion', () => {
  const rooms = [
    { id: 'done', state: 'idle', workRound: { id: 'round-1', status: 'completed' }, messages: [{ ts: 1 }] },
    { id: 'recent-old', state: 'active', live: true, messages: [{ ts: 2 }] },
    { id: 'pending', state: 'active', needsYou: { kind: 'decision' }, messages: [{ ts: 3 }] },
    { id: 'recent-new', state: 'active', live: true, messages: [{ ts: 4 }] },
    { id: 'archived', state: 'stopped', archivedAt: 5, needsYou: { kind: 'decision' }, messages: [{ ts: 5 }] },
  ]
  assert.deepEqual(orderRooms(rooms).map(room => room.id), [
    'pending', 'recent-new', 'recent-old', 'done', 'archived',
  ])
})

test('an active next round is not grouped or labelled as delivered', () => {
  const next = {
    id: 'next',
    name: '下一轮',
    state: 'active',
    activeRoundId: 'round-2',
    workRound: { id: 'round-2', status: 'active' },
    rounds: [{ id: 'round-1', status: 'completed' }],
    messages: [{ ts: 6 }],
  }
  const done = { id: 'done', name: '已交付', state: 'idle', workRound: { id: 'round-1', status: 'completed' }, messages: [{ ts: 1 }] }
  assert.equal(roomLabelOf(next), '下一轮，进行中')
  assert.deepEqual(orderRooms([done, next]).map(room => room.id), ['next', 'done'])
})
