import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { presentRoom } from './presentation.js'
import { SAMPLE_CHAT_ROOM_ID, SAMPLE_ROOM_ID } from './rooms/sample.js'
import { createCrewService } from './service.js'
import { createStore } from './store.js'

const setup = () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'crew-sample-'))
  const store = createStore({ dataDir })
  const service = createCrewService({
    store,
    engine: { health: async () => ({}), instances: async () => [] },
    live: { isAttached: () => false },
    emit: () => {},
    seats: [],
    ports: createCrewPorts(),
  })
  return { dataDir, store, service }
}

test('the sample room is a finished studio that shows the whole handoff', () => {
  const { dataDir, store, service } = setup()
  try {
    const result = service.createSampleRoom()
    assert.equal(result.ok, true)
    assert.equal(result.body.room.id, SAMPLE_ROOM_ID)

    const room = store.readRoom(SAMPLE_ROOM_ID)
    const messages = store.readMessages(SAMPLE_ROOM_ID)
    const view = presentRoom(room, messages)
    assert.equal(view.roomType, 'studio')
    assert.equal(view.state, 'idle')
    assert.equal(view.workRound.status, 'completed')
    assert.equal(view.needsYou, null)
    assert.equal(room.demo, true)
    assert.equal(room.leadMemberId, 'planner')
    assert.equal(room.stages.every(stage => stage.state === 'passed'), true)
    assert.match(room.plan.prose, /我分两步/)
    assert.ok(messages.some(message => message.kind === 'plan' && message.authorId === 'planner'))
    assert.ok(messages.some(message => message.kind === 'handoff' && message.authorId === 'executor'))
    assert.ok(messages.some(message => message.kind === 'verdict' && message.meta?.pass === true))
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('the chat sample is a finished conversation with one conclusion', () => {
  const { dataDir, store, service } = setup()
  try {
    const result = service.createSampleRoom('chat')
    assert.equal(result.ok, true)
    assert.equal(result.body.room.id, SAMPLE_CHAT_ROOM_ID)

    const room = store.readRoom(SAMPLE_CHAT_ROOM_ID)
    const messages = store.readMessages(SAMPLE_CHAT_ROOM_ID)
    assert.equal(room.roomType, 'chat')
    assert.equal(room.demo, true)
    assert.equal(room.state, 'active')
    assert.equal(room.chat.phase, 'concluded')
    assert.ok(messages.some(message => message.kind === 'chat' && message.meta?.opening === true))
    const conclusion = messages.find(message => message.kind === 'chat_conclusion')
    assert.equal(conclusion.authorId, 'lodge-sample')
    assert.equal(room.chat.conclusionId, conclusion.id)
    assert.equal(result.body.room.chat.conclusionId, conclusion.id)
    assert.equal(presentRoom(room, messages).needsYou, null)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('opening the sample twice does not duplicate it', () => {
  const { dataDir, store, service } = setup()
  try {
    service.createSampleRoom()
    const before = store.readMessages(SAMPLE_ROOM_ID).length
    const again = service.createSampleRoom()
    assert.equal(again.ok, true)
    assert.equal(store.readMessages(SAMPLE_ROOM_ID).length, before)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})

test('opening the sample restores an archived one', () => {
  const { dataDir, store, service } = setup()
  try {
    service.createSampleRoom()
    store.updateRoom(SAMPLE_ROOM_ID, room => {
      room.archivedAt = Date.now()
      return { events: [] }
    })
    const again = service.createSampleRoom()
    assert.equal(again.ok, true)
    assert.equal(store.readRoom(SAMPLE_ROOM_ID).archivedAt, null)
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
