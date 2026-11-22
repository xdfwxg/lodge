import assert from 'node:assert/strict'
import test from 'node:test'
import { roomKinds } from '../kinds.js'
import { studioKind } from './kind.js'

const fallback = {
  worker: { requested: 'codex-cli', actual: 'claude', reason: 'missing' },
}

const messageOf = independence => roomKinds
  .find(kind => kind.id === 'studio')
  .initialMessages({
    room: { independence },
    workspaces: { environment: {} },
    engineFallbacks: fallback,
  })[0].text

test('a fallback that keeps a different verifier vendor stays independent', () => {
  const text = messageOf('vendor')
  assert.match(text, /实际跑的是 Claude/)
  assert.match(text, /仍由另一家模型独立复核/)
  assert.doesNotMatch(text, /不是独立复核/)
})

test('a same-vendor fallback says the review is not independent', () => {
  const text = messageOf('none')
  assert.match(text, /不是独立复核/)
})

test('reworking a step clears its old review timeout', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', manual: true, state: 'active' }],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier' }],
  }
  const evidence = { id: 'e1', kind: 'evidence', seq: 1, ts: 1000, meta: { stage: 0, kind: 'manual' } }
  const timeout = {
    id: 't1',
    kind: 'system',
    seq: 2,
    ts: 2000,
    meta: { kind: 'review_timeout', stage: 0, verifiers: ['verifier'] },
  }
  assert.equal(studioKind.needsYou(room, [evidence, timeout]).kind, 'review-timeout')
  const rework = { id: 'r1', kind: 'rework', seq: 3, ts: 3000, meta: { stage: 0 } }
  assert.equal(studioKind.needsYou(room, [evidence, timeout, rework]), null)
})

test('the alignment round keeps only the planner in the base room chat', () => {
  const members = [
    { id: 'planner', name: '规划师', role: 'lead' },
    { id: 'executor', name: '执行官', role: 'worker' },
    { id: 'verifier', name: '验收员', role: 'verifier' },
  ]
  assert.deepEqual(
    studioKind.chatMembersOf({ stages: [{ title: '目标对齐', state: 'pending' }], members }),
    ['planner'],
  )
  assert.deepEqual(
    studioKind.chatMembersOf({ stages: [{ title: '目标对齐', state: 'active' }], members }),
    ['planner'],
  )
  assert.deepEqual(
    studioKind.chatMembersOf({ stages: [{ title: '实现', state: 'active' }], members }),
    ['planner', 'executor', 'verifier'],
  )
})
