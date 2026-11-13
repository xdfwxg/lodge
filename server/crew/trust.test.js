import assert from 'node:assert/strict'
import test from 'node:test'
import { canPromoteTrust, trustLevelOf } from './trust.js'

const stage = (index, over = {}) => ({
  title: `阶段 ${index + 1}`,
  kind: 'deliverable',
  state: 'passed',
  acceptance: 'true',
  ...over,
})

const provenMessages = count => {
  const messages = []
  for (let index = 0; index < count; index += 1) {
    const evidenceId = `e${index}`
    messages.push({ id: evidenceId, kind: 'evidence', seq: index * 3 + 1, meta: { stage: index, kind: 'command', command: 'true', exit: 0 } })
    messages.push({ id: `v${index}`, kind: 'verdict', seq: index * 3 + 2, authorId: 'verifier', meta: { stage: index, pass: true, evidenceId } })
  }
  return messages
}

const room = (over = {}) => ({
  trust: 'verify',
  verifiers: ['verifier'],
  stages: [stage(0), stage(1)],
  ...over,
})

test('trust defaults to verify and old rooms are not auto-elevated', () => {
  assert.equal(trustLevelOf({}), 'verify')
  assert.equal(trustLevelOf({ trust: 'observe' }), 'observe')
  assert.equal(trustLevelOf({ trust: 'auto' }), 'auto')
  assert.equal(trustLevelOf({ trust: 'admin' }), 'verify')
})

test('auto requires two proven deliverable stages and an independent verifier', () => {
  assert.equal(canPromoteTrust(room(), provenMessages(2), 'auto').ok, true)
  assert.equal(canPromoteTrust(room(), provenMessages(1), 'auto').ok, false)
  assert.equal(canPromoteTrust(room({ verifiers: [] }), provenMessages(2), 'auto').ok, false)
})

test('promotion needs evidence and demotion is always allowed', () => {
  assert.equal(canPromoteTrust(room({ trust: 'observe', stages: [stage(0)] }), [], 'verify').ok, true)
  assert.equal(canPromoteTrust(room({ trust: 'observe', stages: [stage(0, { state: 'active' })] }), [], 'verify').ok, false)
  assert.equal(canPromoteTrust(room({ trust: 'auto' }), [], 'observe').ok, true)
  assert.equal(canPromoteTrust(room(), [], 'admin').ok, false)
})
