import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { memberIdFor, migrateMemberRegistry, registerRoomMembers } from './members.js'
import { createStore } from './store.js'

const withStore = fn => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-members-'))
  const store = createStore({ dataDir: dir })
  try {
    return fn(store)
  } finally {
    store.db.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

const room = () => ({
  id: 'room-abc123',
  kind: 'room',
  name: '一间房',
  seatSpecs: [
    { id: 'planner', name: '规划师', title: '规划', skills: [], mcp: [] },
    { id: 'executor', name: '执行官', title: '实现', skills: ['review'], mcp: [] },
  ],
  members: ['planner', 'executor'],
})

test('old rooms get stable member ids and member records on migration', () => {
  withStore(store => {
    store.writeRoom(room())
    migrateMemberRegistry(store)

    const stored = store.readRoom('room-abc123')
    assert.deepEqual(stored.seatSpecs.map(seat => seat.memberId), [
      'member-abc123-planner',
      'member-abc123-executor',
    ])
    assert.deepEqual(store.readMembers().map(member => member.id), [
      'member-abc123-planner',
      'member-abc123-executor',
    ])
    assert.deepEqual(store.readMembers()[1].skills, ['review'])
  })
})

test('migration and registration are idempotent and keep what a member already has', () => {
  withStore(store => {
    store.writeRoom(room())
    migrateMemberRegistry(store)
    const first = store.readMembers()

    store.writeMember({ ...first[0], skills: ['from-elsewhere'] })
    migrateMemberRegistry(store)

    assert.equal(store.readMembers().length, 2)
    assert.deepEqual(store.readMember(first[0].id).skills, ['from-elsewhere'])
    assert.equal(store.readMember(first[0].id).createdAt, first[0].createdAt)
  })
})

test('registerRoomMembers writes the ids into the room object it is given', () => {
  withStore(store => {
    const current = room()
    const changed = registerRoomMembers(store, current)
    assert.equal(changed, true)
    assert.equal(current.seatSpecs[0].memberId, memberIdFor(current.id, 'planner'))
    assert.equal(registerRoomMembers(store, current), false)
  })
})
