import assert from 'node:assert/strict'
import test from 'node:test'
import { seatNameOf } from './seat-name.js'

const room = {
  seatNames: { executor: 'Executorea924d' },
  seatSpecs: [{ id: 'executor', name: '执行者' }],
}

test('seat names resolve from the roster, not from base handles', () => {
  assert.equal(seatNameOf(room, 'executor'), '执行者')
  assert.equal(seatNameOf({ seatNames: { executor: 'Executorea924d' } }, 'executor'), 'executor')
  assert.equal(seatNameOf(room, undefined), '')
  assert.equal(seatNameOf(room, 'ghost'), 'ghost')
})
