import assert from 'node:assert/strict'
import test from 'node:test'
import { PERSONALITIES, personalityPrompt, personalityTurnCue } from '../../shared/personalities.js'
import { chatKind } from './rooms/chat/kind.js'

test('five personalities each carry a label, an instruction, and a turn cue', () => {
  assert.equal(PERSONALITIES.length, 5)
  for (const item of PERSONALITIES) {
    assert.ok(item.id !== '' && item.label !== '' && item.instruction.length > 20)
    assert.ok(item.turnCue.length > 10)
  }
})

test('the prompt states the boundary and the chosen personality', () => {
  const text = personalityPrompt('rigorous')
  assert.match(text, /每个角色固定下面其中一种性格/)
  assert.match(text, /严谨审慎/)
  assert.match(personalityPrompt('unknown'), /中立持衡/)
})

test('each turn cue names the personality and its speaking habit', () => {
  assert.match(personalityTurnCue('cheerful'), /开朗活跃/)
  assert.match(personalityTurnCue('cheerful'), /接住上一位/)
  assert.match(personalityTurnCue('unknown'), /中立持衡/)
})

test('chat seat souls carry the personality instruction', () => {
  const soul = chatKind.seatSoul({ name: '甲', personality: 'gentle' })
  assert.match(soul, /温良善听/)
  assert.match(soul, /200 字以内/)
})
