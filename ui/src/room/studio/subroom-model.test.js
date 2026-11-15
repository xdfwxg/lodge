import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildSubroomRows,
  canCreateSubroom,
  lastVerdictOf,
  subroomStatusOf,
  verdictTextOf,
} from './subroom-model.js'

const room = (id, extra = {}) => ({
  id,
  roomType: 'studio',
  state: 'active',
  childRoomIds: [],
  messages: [],
  ...extra,
})

test('only an active studio below three levels can create a subroom', () => {
  assert.equal(canCreateSubroom(room('a', { depth: 0 })), true)
  assert.equal(canCreateSubroom(room('a', { depth: 2 })), true)
  assert.equal(canCreateSubroom(room('a', { depth: 3 })), false)
  assert.equal(canCreateSubroom(room('a', { state: 'complete' })), false)
  assert.equal(canCreateSubroom(room('a', { roomType: 'chat' })), false)
})

test('the tree follows childRoomIds and keeps depth', () => {
  const child = room('child', { name: '子一', childRoomIds: ['grand'] })
  const grand = room('grand', { name: '孙一' })
  const rows = buildSubroomRows(room('parent', { childRoomIds: ['child'] }), [child, grand])
  assert.deepEqual(rows.map(row => [row.room.id, row.depth]), [['child', 0], ['grand', 1]])
})

test('cycles and unknown children do not recurse forever', () => {
  const a = room('a', { childRoomIds: ['b'] })
  const b = room('b', { childRoomIds: ['a', 'missing'] })
  const rows = buildSubroomRows(a, [a, b])
  assert.deepEqual(rows.map(row => row.room.id), ['b'])
})

test('the last verdict and its label are read from child messages', () => {
  const child = room('child', {
    messages: [
      { kind: 'verdict', meta: { pass: false } },
      { kind: 'system', text: 'x' },
      { kind: 'verdict', meta: { pass: true } },
    ],
  })
  assert.equal(verdictTextOf(lastVerdictOf(child)), '通过')
  assert.equal(verdictTextOf(lastVerdictOf(room('empty'))), '还没检查')
})

test('status prefers the room state over the closure', () => {
  assert.equal(subroomStatusOf(room('a', { closure: 'executing' })), '正在做')
  assert.equal(subroomStatusOf(room('a', { state: 'complete', closure: 'signed' })), '做完了')
  assert.equal(subroomStatusOf(room('a', { state: 'paused' })), '先停一下')
})
