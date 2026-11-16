import assert from 'node:assert/strict'
import test from 'node:test'
import { roomModeForType } from '../kinds.js'

const mode = roomModeForType('studio')
const soulOf = member => mode.memberSoul({ prompt: '', mcp: [], ...member })

test('studio souls ask for work logs instead of essays', () => {
  const lead = soulOf({ role: 'lead', name: '规划师' })
  assert.match(lead, /一行工作日志/)
  const worker = soulOf({ role: 'worker', name: '执行官' })
  assert.match(worker, /三行工作日志/)
  assert.match(worker, /做了什么/)
  assert.match(worker, /不要先发/)
  const verifier = soulOf({ role: 'verifier', name: '验收员' })
  assert.match(verifier, /一句结论/)
})
