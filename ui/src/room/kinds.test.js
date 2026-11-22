import assert from 'node:assert/strict'
import test from 'node:test'
import { ROOM_TYPE_MANIFEST } from '../../../shared/room-types.js'
import { roomUiKinds, uiKindOfRoom, uiKindOfType } from './kinds.js'

const KEYS = [
  'id', 'owns', 'label', 'defaultMembers', 'icon', 'teamMode', 'startMode', 'cta',
  'goalLabel', 'goalIcon', 'workspace',
  'missingVerifier', 'readOnly', 'membersInSidebar', 'hasHistory', 'primaryFields', 'setupFields', 'buildRequest',
]

test('both UI room kinds satisfy the same interface', () => {
  for (const kind of roomUiKinds) {
    for (const key of KEYS) assert.ok(key in kind, `${kind.id} misses ${key}`)
    assert.equal(typeof kind.icon, 'function', `${kind.id} icon is not a component`)
    assert.equal(kind.owns(kind.id), true)
    assert.equal(uiKindOfRoom({ roomType: kind.id }), kind)
    assert.equal(uiKindOfType(kind.id), kind)
  }
})

test('room kinds own exactly one type', () => {
  for (const kind of roomUiKinds) {
    for (const other of roomUiKinds) {
      if (other.id !== kind.id) assert.equal(kind.owns(other.id), false)
    }
  }
})

test('an omitted room type falls back to the studio kind', () => {
  assert.equal(uiKindOfRoom({}).id, 'studio')
})

test('history and member management follow each room kind', () => {
  assert.equal(uiKindOfType('studio').hasHistory, true)
  assert.equal(uiKindOfType('chat').hasHistory, false)
  assert.equal(uiKindOfType('chat').membersCanBeAdded, false)
})

test('UI labels come from the shared room-type manifest', () => {
  assert.deepEqual(roomUiKinds.map(kind => kind.id), ROOM_TYPE_MANIFEST.map(item => item.id))
  for (const kind of roomUiKinds) {
    const meta = ROOM_TYPE_MANIFEST.find(item => item.id === kind.id)
    assert.equal(kind.label, meta.name)
  }
})
