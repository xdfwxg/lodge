import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryKindOf } from './delivery.js'

test('the room result names its shape, not its renderer', () => {
  assert.equal(deliveryKindOf({ artifacts: [{ path: 'report.md' }] }), 'document')
  assert.equal(deliveryKindOf({ artifacts: [{ path: 'report.md' }, { path: 'notes.md' }] }), 'document')
  assert.equal(deliveryKindOf({ artifacts: [{ path: 'report.md' }, { path: 'shot.png' }] }), 'mixed')
  assert.equal(deliveryKindOf({ artifacts: [{ path: 'guide.pdf' }] }), 'file')
  assert.equal(deliveryKindOf({ changedFiles: ['src/a.js'] }), 'workspace')
  assert.equal(deliveryKindOf({ workspacePath: '/tmp/room' }), 'workspace')
  assert.equal(deliveryKindOf({}), 'empty')
})
