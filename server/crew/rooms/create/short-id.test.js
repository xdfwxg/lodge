import assert from 'node:assert/strict'
import test from 'node:test'
import { uniqueRoomShort } from './short-id.js'

test('a short id skips existing rooms, source dirs and scratch dirs', () => {
  const uuids = [
    'aaaaaaaa-0000-4000-8000-000000000000',
    'bbbbbbbb-0000-4000-8000-000000000000',
    'cccccccc-0000-4000-8000-000000000000',
    'dddddddd-0000-4000-8000-000000000000',
  ]
  let index = 0
  const short = uniqueRoomShort({
    store: { readRoom: id => (id === 'room-aaaaaaaa' ? { id } : null) },
    workspace: {
      root: () => '/workspaces',
      exists: path => path === '/workspaces/room-bbbbbbbb' || path === '/scratch/cccccccc',
    },
    provider: { scratchRoot: () => '/scratch' },
    uuid: () => uuids[index++],
  })
  assert.equal(short, 'dddddddd')
})

test('a short id fails instead of reusing a busy workspace', () => {
  assert.throws(
    () => uniqueRoomShort({
      store: { readRoom: () => null },
      workspace: { root: () => '/workspaces', exists: () => true },
      provider: { scratchRoot: () => '/scratch' },
      attempts: 2,
      uuid: () => 'aaaaaaaa-0000-4000-8000-000000000000',
    }),
    /没能分配一个空的房间目录/,
  )
})
