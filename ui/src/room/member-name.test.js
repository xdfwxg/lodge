import assert from 'node:assert/strict'
import test from 'node:test'
import { memberNameOf } from './member-name.js'

const room = {
  members: [{ id: 'executor', name: '执行者', body: { kind: 'base', name: 'Executorea924d' } }],
}

test('member names resolve from the roster, not from base names', () => {
  assert.equal(memberNameOf(room, 'executor'), '执行者')
  assert.equal(memberNameOf({ members: [] }, 'executor'), 'executor')
  assert.equal(memberNameOf(room, undefined), '')
  assert.equal(memberNameOf(room, 'ghost'), 'ghost')
})
