import assert from 'node:assert/strict'
import test from 'node:test'
import { roomModeForType } from '../kinds.js'

const mode = roomModeForType('studio')
const soulOf = seat => mode.seatSoul({ prompt: '', mcp: [], ...seat })

test('the planner keeps its tool protocol in the static soul', () => {
  const soul = soulOf({ role: 'lead', name: '规划师' })
  assert.match(soul, /<lodge-tool>/)
  assert.match(soul, /create_subroom/)
})

test('other seats do not receive planner tools', () => {
  const soul = soulOf({ role: 'worker', name: '执行官' })
  assert.doesNotMatch(soul, /create_subroom/)
})
