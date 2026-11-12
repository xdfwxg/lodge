import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseFreePort, portIsFree } from './workspace-ports.js'

test('an occupied port is skipped in steps of ten', () => {
  const occupied = new Set([4100, 4110])
  const chosen = chooseFreePort(4100, { isFree: port => !occupied.has(port) })
  assert.equal(chosen.port, 4120)
  assert.equal(chosen.next, 4130)
})

test('the lsof probe treats a listening pid as occupied', () => {
  assert.equal(portIsFree(4100, { exec: () => '123\n' }), false)
  assert.equal(portIsFree(4100, { exec: () => '' }), true)
  assert.equal(portIsFree(4100, { exec: () => { throw new Error('lsof missing') } }), true)
})
