import assert from 'node:assert/strict'
import test from 'node:test'
import { chatKind } from './kind.js'

test('a chat member carries its speaking habit into the soul', () => {
  const soul = chatKind.memberSoul({
    name: '甲',
    voice: '先问代价，再问能不能落地。',
    stance: 'critic',
    personality: 'rigorous',
  })
  assert.match(soul, /你的说话习惯：先问代价，再问能不能落地。/)
  assert.match(soul, /专门找漏洞/)
  assert.match(soul, /严谨审慎/)
})

test('a member without a speaking habit gets no empty line', () => {
  const soul = chatKind.memberSoul({ name: '乙', stance: 'proposer', personality: 'assertive' })
  assert.doesNotMatch(soul, /你的说话习惯/)
  assert.doesNotMatch(soul, /\n\n/)
})
