import assert from 'node:assert/strict'
import test from 'node:test'
import { gateFor } from './rooms/studio/gates.js'

const verifier = (id, name) => ({ id, name, role: 'verifier', roleKind: 'verifier', permissions: { read: true, exec: true, write: false }, toolSurface: ['read', 'exec'], skills: [], mcp: [], body: { kind: 'base', ref: `bot-${id}`, name } })
const room = (over = {}) => ({
  id: 'room-1',
  members: [verifier('verifier', '验收员')],
  demo: false,
  live: true,
  openQuestion: null,
  stages: [
    { title: 'align', kind: 'decision', state: 'passed' },
    { title: 'impl', kind: 'deliverable', state: 'active', deliverable: '把事做完' },
  ],
  ...over,
})

const evidence = (stage = 1, seq = 10, meta = {}) => ({
  id: `e-${seq}`,
  kind: 'evidence',
  seq,
  // 现在的每个交付都要带一条平台跑过的证明；需要验证缺证明的用例自己覆盖它。
  meta: { stage, kind: 'result', proof: { status: 'verified', exit: 0, weak: false }, ...meta },
})
const verdict = (stage = 1, seq = 11, pass = true, meta = {}, authorId = 'verifier') => ({
  id: `v-${seq}`,
  kind: 'verdict',
  authorId,
  seq,
  meta: { stage, pass, ...meta },
})

test('a stage waits for its declared dependencies', () => {
  const r = room({ members: [] })
  r.stages[0].state = 'active'
  r.stages[1].dependsOn = [0]
  const blocked = gateFor(r, 1, [evidence(), verdict()])
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /先完成阶段 1/)
  r.stages[0].state = 'passed'
  assert.equal(gateFor(r, 1, [evidence(), verdict()]).ok, true)
})

test('a contract room cannot pass without a verified proof', () => {
  const contract = { outcomes: [{ id: 'done', statement: '把事做完', observable: '命令退出码为 0' }] }
  const r = room({ plan: { contract } })
  const missing = gateFor(r, 1, [evidence(1, 10, { proof: { status: 'missing' } }), verdict(1, 11, true, { evidenceId: 'e-10' })])
  assert.equal(missing.ok, false)
  assert.match(missing.error, /没有可重跑的证明/)
  const verified = gateFor(r, 1, [evidence(1, 10, { proof: { status: 'verified', exit: 0 } }), verdict(1, 11, true, { evidenceId: 'e-10' })])
  assert.equal(verified.ok, true, verified.error)
})

test('an out-of-package change that cannot be reverted blocks confirmation', () => {
  const r = room()
  const blocked = gateFor(r, 1, [
    evidence(1, 10, { outOfBounds: { files: ['src/other.js'], reverted: [] } }),
    verdict(1, 11, true, { evidenceId: 'e-10' }),
  ])
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /工作包之外/)
  const reverted = gateFor(r, 1, [
    evidence(1, 10, { outOfBounds: { files: ['src/other.js'], reverted: ['src/other.js'] } }),
    verdict(1, 11, true, { evidenceId: 'e-10' }),
  ])
  assert.equal(reverted.ok, true, reverted.error)
})

test('a proof that misses a clause step or has a red step cannot be confirmed', () => {
  const r = room()
  const incomplete = gateFor(r, 1, [
    evidence(1, 10, { proof: { status: 'incomplete', exit: 0, missingClauses: ['export'] } }),
    verdict(1, 11, true, { evidenceId: 'e-10' }),
  ])
  assert.equal(incomplete.ok, false)
  assert.match(incomplete.error, /没有覆盖每条契约要求/)
  assert.match(incomplete.error, /export/)
  const failed = gateFor(r, 1, [
    evidence(1, 10, { proof: { status: 'failed', exit: 0, error: '证明的 step 没跑绿：npm test' } }),
    verdict(1, 11, true, { evidenceId: 'e-10' }),
  ])
  assert.equal(failed.ok, false)
  assert.match(failed.error, /没跑绿/)
})

test('rejects a stage that is not active', () => {
  const r = room()
  r.stages[1].state = 'pending'
  assert.equal(gateFor(r, 1, []).ok, false)
})

test('open question blocks confirmation', () => {
  const gate = gateFor(room({ openQuestion: 'callback path?' }), 1, [])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /问题/)
})

test('a stage without a result cannot pass', () => {
  const gate = gateFor(room(), 1, [])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /还没有交回结果/)
})

test('result evidence alone is not a verdict; a verifier PASS is required', () => {
  const waiting = gateFor(room(), 1, [evidence()])
  assert.equal(waiting.ok, false)
  assert.match(waiting.error, /没有回报|验收通过|还没有交回结果/)
  assert.equal(gateFor(room(), 1, [evidence(), verdict(1, 11, true, { evidenceId: 'e-10' })]).ok, true)
})

test('multiple verifiers must all PASS the same evidence', () => {
  const r = room({ members: [verifier('v1', '验收一'), verifier('v2', '验收二')] })
  const pending = gateFor(r, 1, [evidence(), verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1')])
  assert.equal(pending.ok, false)
  assert.match(pending.error, /没有回报/)
  const passed = gateFor(r, 1, [
    evidence(),
    verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1'),
    verdict(1, 12, true, { evidenceId: 'e-10' }, 'v2'),
  ])
  assert.equal(passed.ok, true)
  const rejected = gateFor(r, 1, [
    evidence(),
    verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1'),
    verdict(1, 12, false, { evidenceId: 'e-10' }, 'v2'),
  ])
  assert.equal(rejected.ok, false)
})

test('a newer result invalidates PASSes that pointed at the older one', () => {
  const gate = gateFor(room(), 1, [
    evidence(1, 10),
    verdict(1, 11, true, { evidenceId: 'e-10' }),
    evidence(1, 12),
  ])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /没有回报|验收通过|还没有交回结果/)
})

test('a PASS without an outside-diff risk cannot be signed off', () => {
  const judgment = {
    version: 1,
    type: 'verdict',
    decision: 'pass',
    reason: '都对',
    findings: [],
    outsideDiff: '',
    stage: 1,
    source: 'gate',
  }
  const missing = gateFor(room(), 1, [evidence(), verdict(1, 11, true, { evidenceId: 'e-10', judgment })])
  assert.equal(missing.ok, false)
  assert.match(missing.error, /diff 之外/)
  const withRisk = verdict(1, 12, true, { evidenceId: 'e-10', judgment: { ...judgment, outsideDiff: '无' } })
  assert.equal(gateFor(room(), 1, [evidence(), withRisk]).ok, true)
})

test('a room without verifiers is signed off on result evidence', () => {
  const gate = gateFor(room({ members: [] }), 1, [evidence()])
  assert.equal(gate.ok, true)
  assert.equal(gate.stage.title, 'impl')
  assert.match(gateFor(room({ members: [] }), 1, []).error, /还没有交回结果/)
})

test('a room without verifiers with a REJECT must rework', () => {
  const gate = gateFor(room({ members: [] }), 1, [evidence(), verdict(1, 11, false)])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /重做/)
})

test('a human rework invalidates an earlier PASS', () => {
  const rework = { id: 'r-1', kind: 'rework', authorId: 'you', seq: 12, meta: { stage: 1 } }
  const gate = gateFor(room(), 1, [evidence(1, 10), verdict(1, 11, true, { evidenceId: 'e-10' }), rework])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /没有回报|验收通过|还没有交回结果/)
})

test('a REJECT is superseded by new result evidence and a new PASS', () => {
  const messages = [
    evidence(1, 10),
    verdict(1, 11, false, { evidenceId: 'e-10' }),
    evidence(1, 12),
    verdict(1, 13, true, { evidenceId: 'e-12' }),
  ]
  assert.equal(gateFor(room(), 1, messages).ok, true)
})

test('demo rooms accept simulated result evidence only with PASS', () => {
  const r = room({ demo: true })
  const simulated = evidence(1, 10, { simulated: true })
  assert.equal(gateFor(r, 1, [simulated, verdict(1, 11, true, { evidenceId: 'e-10' })]).ok, true)
})
