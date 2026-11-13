import assert from 'node:assert/strict'
import test from 'node:test'
import { canCreateSubroom, childDepthOf, childResultText, childVerdictsOf } from './room-subrooms.js'

test('only a studio below the depth limit can create a subroom', () => {
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'active', depth: 0 }), true)
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'active', depth: 2 }), true)
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'active', depth: 3 }), false)
  assert.equal(canCreateSubroom({ roomType: 'chat', state: 'active', depth: 0 }), false)
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'complete', depth: 0 }), false)
  assert.equal(childDepthOf({ depth: 2 }), 3)
})

test('parent gets only child Verifier verdicts', () => {
  const messages = [
    { kind: 'verdict', text: 'PASS', meta: { roleKind: 'verifier', pass: true, mode: 'bot', stage: 0 } },
    { kind: 'verdict', text: 'PASS', meta: { roleKind: 'verifier', pass: true, mode: 'human', stage: 0 } },
    { kind: 'evidence', text: 'not a verdict', meta: {} },
  ]
  const verdicts = childVerdictsOf(messages)
  assert.equal(verdicts.length, 2)
  assert.equal(verdicts[1].mode, 'human')
  assert.match(childResultText({ name: '子房' }, verdicts), /Verifier 结果/)
})
