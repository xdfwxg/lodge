import assert from 'node:assert/strict'
import test from 'node:test'
import { shadowFor } from './shadow-model.js'

const verdict = (id, evidenceId, pass) => ({
  id,
  kind: 'verdict',
  authorId: 'verifier',
  text: pass ? 'PASS\nok' : 'REJECT\nno',
  meta: { evidenceId, pass, stage: 0 },
})

const advice = (evidenceId, score, shadow = true) => ({
  id: `advice-${evidenceId}`,
  kind: 'advisor_advice',
  meta: { evidenceId, stage: 0, shadow, advice: [{ score, summary: 'summary', reasons: ['r'] }] },
})

test('shadow comparison marks agreement and disagreement', () => {
  const room = {
    messages: [
      verdict('v1', 'e1', true),
      advice('e1', 0.8),
      verdict('v2', 'e2', false),
      advice('e2', 0.9),
      verdict('v3', 'e3', true),
      advice('e3', 0.5),
      verdict('v4', 'e4', true),
    ],
  }
  assert.equal(shadowFor(room, room.messages[0]).status, 'agree')
  assert.equal(shadowFor(room, room.messages[2]).status, 'disagree')
  assert.equal(shadowFor(room, room.messages[4]).status, 'neutral')
  assert.equal(shadowFor(room, room.messages[6]), null)
})

test('the card follows the last verdict for an evidence and keeps mixed votes', () => {
  const room = {
    messages: [
      verdict('v1', 'e1', true),
      verdict('v2', 'e1', false),
      advice('e1', 0.8),
    ],
  }
  assert.equal(shadowFor(room, room.messages[0]), null)
  const shadow = shadowFor(room, room.messages[1])
  assert.equal(shadow.status, 'mixed')
  assert.equal(shadow.verdicts.length, 2)
})

test('advice without an injected shadow flag is still shown as an advisory card', () => {
  const room = { messages: [verdict('v1', 'e1', true), advice('e1', 0.8, false)] }
  assert.equal(shadowFor(room, room.messages[0]).advice.shadow, false)
})
