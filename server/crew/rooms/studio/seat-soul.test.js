import assert from 'node:assert/strict'
import test from 'node:test'
import { roomModeForType } from '../kinds.js'

const mode = roomModeForType('studio')
const soulOf = member => mode.memberSoul({ prompt: '', mcp: [], ...member })

test('studio souls ask members to talk like people, not fill in logs', () => {
  const lead = soulOf({ role: 'lead', name: '规划师' })
  assert.match(lead, /像给同事发消息/)
  // 接力只在工作契约里写一次，每个角色都拿得到；系统负责投递。
  assert.match(lead, /交给谁（写名字，不带 @）/)
  const worker = soulOf({ role: 'worker', name: '执行官' })
  assert.match(worker, /像给同事发消息/)
  assert.match(worker, /有多点时用短列表或加粗小标题/)
  assert.match(worker, /不要先发/)
  const verifier = soulOf({ role: 'verifier', name: '验收员' })
  assert.match(verifier, /diff 之外/)
  assert.match(lead, /\*\*加粗\*\*只给会影响决定的信息/)
  assert.match(worker, /\*\*加粗\*\*只给会影响决定的信息/)
  assert.match(verifier, /\*\*加粗\*\*只给会影响决定的信息/)
})
