import assert from 'node:assert/strict'
import test from 'node:test'
import { LODGE_HOST_RULES, LODGE_HOST_SOUL } from './lodge-host.js'

test('the Lodge host listens, routes, closes, and stays out of the work', () => {
  assert.equal(LODGE_HOST_RULES.length, 5)
  assert.match(LODGE_HOST_RULES.join('\n'), /听清楚/)
  assert.match(LODGE_HOST_RULES.join('\n'), /自动追问/)
  assert.match(LODGE_HOST_RULES.join('\n'), /分流/)
  assert.match(LODGE_HOST_RULES.join('\n'), /收束/)
  assert.match(LODGE_HOST_RULES.join('\n'), /不替成员干活/)
  assert.match(LODGE_HOST_SOUL, /判断这件事该去哪里/)
})
