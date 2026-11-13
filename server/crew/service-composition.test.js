import assert from 'node:assert/strict'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createCrewService } from './service.js'

const store = {
  readRoom: () => null,
  readRooms: () => [],
  readMessages: () => [],
  readMessagesSince: () => [],
  writeRoom: () => {},
  updateRoom: () => null,
  appendMessage: () => ({ id: 'm1' }),
  appendEvent: () => {},
}

const service = () => createCrewService({
  store,
  engine: { health: async () => ({}), instances: async () => [] },
  live: {},
  emit: () => {},
  seats: [],
  ports: createCrewPorts(),
})

test('the service facade keeps every route entry', () => {
  const instance = service()
  for (const name of [
    'state',
    'health',
    'messagesSince',
    'evidence',
    'resetMcp',
    'resources',
    'usage',
    'projectConstraints',
    'review',
    'transitions',
    'evidenceLedger',
    'evidenceIntegrity',
    'shadowReview',
    'deliveryExport',
    'removeSeat',
    'changeSeatRole',
    'handoff',
    'createRoom',
    'recommendRoster',
    'roomRequest',
  ]) {
    assert.equal(typeof instance[name], 'function', `${name} is missing`)
  }
})

test('roomRequest still fails closed for a missing room', async () => {
  const result = await service().roomRequest('missing', 'pause', { method: 'POST' })
  assert.deepEqual(result, { ok: false, reason: 'not_found', error: '没有这个房间' })
})
