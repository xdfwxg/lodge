import assert from 'node:assert/strict'
import test from 'node:test'
import { ROOM_TYPE_MANIFEST } from '../../../shared/room-types.js'
import { capabilitiesFor, listRoomTypes } from './index.js'

test('registered room types match the shared product manifest', () => {
  const registered = listRoomTypes()
  assert.deepEqual(
    registered.map(type => type.id).sort(),
    ROOM_TYPE_MANIFEST.map(type => type.id).sort(),
  )
  for (const type of registered) {
    const meta = ROOM_TYPE_MANIFEST.find(item => item.id === type.id)
    assert.equal(type.name, meta.name)
    assert.equal(type.description, meta.description)
    assert.equal(type.defaultVerify, meta.defaultVerify)
  }
})

test('capabilities come from the shared manifest', () => {
  for (const meta of ROOM_TYPE_MANIFEST) {
    assert.deepEqual(capabilitiesFor(meta.id), meta.capabilities)
  }
})
