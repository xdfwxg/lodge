import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ensureLodgeRoom } from './lodge.js'
import { LODGE_ROOM_ID } from '../../../shared/lodge.js'

test('an existing Lodge host receives the current host soul', async () => {
  const calls = []
  const existing = {
    id: LODGE_ROOM_ID,
    archivedAt: null,
    chatHost: { memberRef: 'bot-lodge' },
  }
  const store = { readRoom: () => existing }
  const engine = {
    patchMemberBot: async (id, payload) => calls.push({ id, payload }),
  }
  const room = await ensureLodgeRoom({
    store,
    engine,
    live: {},
    workspace: { root: () => '/tmp' },
  })
  assert.equal(room, existing)
  assert.equal(calls[0].id, 'bot-lodge')
  assert.match(calls[0].payload.soul, /听清楚/)
  assert.match(calls[0].payload.soul, /分流/)
  assert.match(calls[0].payload.soul, /收束/)
})

test('a Lodge host missing from the base clears local history and rebuilds the entrance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-repair-'))
  const messages = []
  let cleared = false
  let detached = false
  let current = {
    id: LODGE_ROOM_ID,
    archivedAt: null,
    chatHost: { memberRef: 'gone-bot', name: 'LodgeHostOld', displayName: 'Lodge' },
    chatRoom: { id: 'gone-room', sessionRef: 'gone-thread' },
  }
  const store = {
    readRoom: () => current,
    writeRoom: room => { current = room },
    deleteRoom: () => {
      cleared = true
      current = null
      return true
    },
    updateRoom: (id, mutate) => {
      const next = structuredClone(current)
      mutate(next)
      current = next
      return current
    },
    appendMessage: (id, message) => {
      messages.push(message)
      return { id: `m${messages.length}`, ...message }
    },
  }
  const engine = {
    patchMemberBot: async () => { throw new Error('base 404 /api/bots/gone-bot: {"error":"no such bot"}') },
    createMemberBot: async ({ name }) => ({ id: 'bot-new', name }),
    createRoom: async () => ({ id: 'base-room-new', sessionRef: 'thread-new' }),
    deleteRoom: async () => {},
    deleteMemberBot: async () => {},
  }
  let attached = null
  try {
    const room = await ensureLodgeRoom({
      store,
      engine,
      live: { attach: async value => { attached = value }, detach: () => { detached = true } },
      workspace: { root: () => root },
    })
    assert.equal(cleared, true)
    assert.equal(detached, true)
    assert.equal(room.chatHost.memberRef, 'bot-new')
    assert.equal(room.chatRoom.id, 'base-room-new')
    assert.equal(attached?.chatRoom?.id, 'base-room-new')
    assert.ok(messages.some(message => /我是 Lodge/.test(message.text ?? '')))
    assert.equal(messages.some(message => /接回来/.test(message.text ?? '')), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
