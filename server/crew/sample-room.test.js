import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { presentRoom } from './presentation.js'
import { SAMPLE_ROOM_ID } from './rooms/sample.js'
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

test('the sample room is a complete chat with a confirmed conclusion', () => {
  const { dataDir, store, service } = setup()
  try {
    const result = service.createSampleRoom()
    assert.equal(result.ok, true)
    assert.equal(result.body.room.id, SAMPLE_ROOM_ID)

    const room = store.readRoom(SAMPLE_ROOM_ID)
    const messages = store.readMessages(SAMPLE_ROOM_ID)
    const view = presentRoom(room, messages)
    assert.equal(view.roomType, 'chat')
    assert.equal(view.state, 'complete')
    assert.equal(view.needsYou, null)
    assert.equal(view.hostLabel, 'Lodge 主持')
    assert.equal(room.chat.phase, 'accepted')
    assert.equal(room.demo, true)

    const conclusion = messages.find(message => message.kind === 'chat_conclusion')
    assert.match(conclusion.meta.handoff.topic, /羽仙记/)
    assert.equal(conclusion.meta.handoff.todos.length, 2)
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
