import assert from 'node:assert/strict'
import test from 'node:test'
import { acceptanceOf, deliveryBlockersOf, deliveryFactsOf, requiresProofOf } from './acceptance.js'

const evidence = (meta = {}) => ({ id: 'e-1', kind: 'evidence', seq: 10, meta: { stage: 0, kind: 'result', ...meta } })
const codes = blockers => blockers.map(item => item.code)

test('a verified proof with no out-of-bounds changes has no delivery blocker', () => {
  const facts = deliveryFactsOf({
    evidence: evidence({
      proof: { status: 'verified', entries: [{ entry: 'node tools/check.mjs', status: 'verified' }] },
      changedFiles: ['hello.txt'],
    }),
  })
  assert.deepEqual(deliveryBlockersOf({ facts, requireProof: true }), [])
  assert.deepEqual(facts.proof.entries, ['node tools/check.mjs'])
  assert.deepEqual(facts.changedFiles, ['hello.txt'])
})

test('every delivery problem is one blocker with a sentence the room can show', () => {
  const outside = deliveryFactsOf({ evidence: evidence({ outOfBounds: { files: ['a.txt'], reverted: [] } }) })
  assert.deepEqual(codes(deliveryBlockersOf({ facts: outside })), ['out-of-bounds'])

  const failed = deliveryFactsOf({ evidence: evidence({ proof: { status: 'failed', error: 'entry 退出 1' } }) })
  assert.match(deliveryBlockersOf({ facts: failed })[0].text, /entry 退出 1/)

  const weak = deliveryFactsOf({ evidence: evidence({ proof: { status: 'verified', weak: true } }) })
  assert.deepEqual(codes(deliveryBlockersOf({ facts: weak })), ['proof-weak'])
  // 这一步自己就在交证明文件时，证明不可能“改动前也失败”；不谈这一条，
  // 否则执行官只能把同一份证明再交一遍（真房连退三次）。
  assert.deepEqual(codes(deliveryBlockersOf({ facts: weak, proofIsDeliverable: true })), [])
})

test('a record with no proof is only a blocker when the step declares requirements', () => {
  const facts = deliveryFactsOf({ evidence: evidence({}) })
  assert.equal(facts.proof.status, 'unknown')
  assert.deepEqual(deliveryBlockersOf({ facts, requireProof: false }), [])
  assert.deepEqual(codes(deliveryBlockersOf({ facts, requireProof: true })), ['proof-missing'])
  // 声明了 clauseIds 或工作包的步骤就要求证明；示例房那种没有声明的步骤不要求。
  const room = { stages: [{ title: 'impl', clauseIds: ['c1'] }] }
  assert.equal(requiresProofOf({ room, stage: room.stages[0], stageIndex: 0 }), true)
  assert.equal(requiresProofOf({ room, stage: { packages: [{ files: ['a'] }] }, stageIndex: 0 }), true)
  assert.equal(requiresProofOf({ room, stage: { title: 'impl' }, stageIndex: 0 }), false)
  // 计划把证明放到后面某一步时，前面这一步不要求证明（否则那一步的交付永远补不上）。
  const split = {
    stages: [
      { title: 'files', clauseIds: ['c1'], packages: [{ files: ['hello.txt'] }] },
      { title: 'proof', clauseIds: ['c2'], packages: [{ files: ['lodge-proof.json'] }] },
    ],
  }
  assert.equal(requiresProofOf({ room: split, stage: split.stages[0], stageIndex: 0 }), false)
  assert.equal(requiresProofOf({ room: split, stage: split.stages[1], stageIndex: 1 }), true)
})

test('acceptance is one decision: delivery facts plus the verdict', () => {
  const room = {
    goal: 'ship it',
    stages: [{ title: 'impl', state: 'active', clauseIds: ['c1'], deliverable: '把事做完' }],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier' }],
    verifiers: ['verifier'],
  }
  const verified = evidence({
    proof: { status: 'verified', entries: [{ entry: 'node --test', status: 'verified' }] },
    changedFiles: ['hello.txt'],
  })
  const pass = {
    id: 'v-1',
    kind: 'verdict',
    authorId: 'verifier',
    seq: 11,
    meta: { stage: 0, pass: true, evidenceId: 'e-1', judgment: { decision: 'pass', stage: 0, evidenceId: 'e-1' } },
  }
  const ok = acceptanceOf({ room, stageIndex: 0, messages: [verified, pass], evidence: verified })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.blockers, [])

  // 证明本身不合格：交付的事实说了算，和谁验收无关。
  const unproven = evidence({ changedFiles: ['hello.txt'] })
  const blocked = acceptanceOf({ room, stageIndex: 0, messages: [unproven, pass], evidence: unproven })
  assert.equal(blocked.ok, false)
  assert.deepEqual(codes(blocked.blockers), ['proof-missing'])

  // 没有结果证据：第一个 blocker 就是这件事。
  const noResult = acceptanceOf({ room, stageIndex: 0, messages: [], evidence: undefined })
  assert.deepEqual(codes(noResult.blockers), ['no-result'])
})
