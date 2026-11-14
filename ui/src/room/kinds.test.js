import assert from 'node:assert/strict'
import test from 'node:test'
import { roomUiKinds, uiKindOfRoom, uiKindOfType } from './kinds.js'

const KEYS = [
  'id', 'owns', 'label', 'glyph', 'teamMode', 'startMode', 'cta', 'dialogSub',
  'resumeSub', 'railTabs', 'showEvidence', 'showDelivery', 'showShadow',
  'showAdvanced', 'statusLine', 'subtitle', 'missingVerifier', 'setupFields',
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
