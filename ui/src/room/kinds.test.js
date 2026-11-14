import assert from 'node:assert/strict'
import test from 'node:test'
import { ROOM_TYPE_MANIFEST } from '../../../shared/room-types.js'
import { roomUiKinds, uiKindOfRoom, uiKindOfType } from './kinds.js'

const KEYS = [
  'id', 'owns', 'label', 'teamMode', 'startMode', 'cta', 'dialogSub',
  'resumeSub', 'goalLabel', 'goalIcon', 'showShadowReview', 'workspace',
  'railTabs', 'showEvidence', 'showDelivery', 'showShadow',
  'showAdvanced', 'statusLine', 'subtitle', 'missingVerifier', 'setupFields',
  'buildRequest', 'advancedPanel',
]

test('both UI room kinds satisfy the same interface', () => {
  for (const kind of roomUiKinds) {
    for (const key of KEYS) assert.ok(key in kind, `${kind.id} misses ${key}`)
    assert.equal(uiKindOfRoom({ roomType: kind.id }), kind)
    assert.equal(uiKindOfType(kind.id), kind)
  }
})

test('an omitted room type falls back to the studio kind', () => {
  assert.equal(uiKindOfRoom({}).id, 'studio')
})

test('UI labels come from the shared room-type manifest', () => {
  assert.deepEqual(roomUiKinds.map(kind => kind.id), ROOM_TYPE_MANIFEST.map(item => item.id))
  for (const kind of roomUiKinds) {
    const meta = ROOM_TYPE_MANIFEST.find(item => item.id === kind.id)
    assert.equal(kind.label, meta.name)
  }
})
