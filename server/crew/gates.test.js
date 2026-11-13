import assert from 'node:assert/strict'
import test from 'node:test'
import { gateFor } from './gates.js'

const room = (over = {}) => ({
  id: 'room-1',
  demo: false,
  live: true,
  openQuestion: null,
  stages: [
    { title: 'align', kind: 'decision', state: 'passed' },
    { title: 'impl', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
  ],
  ...over,
})

const evidence = (stage = 1, seq = 10, meta = {}) => ({
  id: `e-${seq}`,
  kind: 'evidence',
  seq,
  meta: { stage, kind: 'command', command: 'npm test', exit: 0, ...meta },
})
const verdict = (stage = 1, seq = 11, pass = true, meta = {}, authorId = 'verifier') => ({
  id: `v-${seq}`,
  kind: 'verdict',
  authorId,
  seq,
  meta: { stage, pass, ...meta },
})

test('a stage waits for its declared dependencies', () => {
  const r = room({ verifiers: [] })
  r.stages[0].state = 'active'
  r.stages[1].dependsOn = [0]
  const blocked = gateFor(r, 1, [evidence(), verdict()])
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /先完成阶段 1/)
  r.stages[0].state = 'passed'
  const open = gateFor(r, 1, [evidence(), verdict()])
  assert.equal(open.ok, true)
})

test('rejects a stage that is not active', () => {
  const r = room()
  r.stages[1].state = 'pending'
  const gate = gateFor(r, 1, [])
  assert.equal(gate.ok, false)
  assert.equal(gate.reason, 'conflict')
})

test('a manual stage cannot be signed off before its Verifier passes', () => {
  const r = room({
    verifiers: ['verifier'],
    seatNames: { verifier: '验收员' },
    stages: [
      { title: 'align', kind: 'decision', state: 'passed' },
      { title: 'artifact', kind: 'decision', manual: true, state: 'active' },
    ],
  })
  const manual = {
    id: 'm-1',
    kind: 'evidence',
    seq: 10,
    meta: { stage: 1, kind: 'manual', simulated: false },
  }
  const waiting = gateFor(r, 1, [manual])
  assert.equal(waiting.ok, false)
  assert.match(waiting.error, /没有回报|Verifier PASS/)
  const passed = gateFor(r, 1, [manual, verdict(1, 11, true, { evidenceId: 'm-1' })])
  assert.equal(passed.ok, true)
  const rejected = gateFor(r, 1, [manual, verdict(1, 11, false, { evidenceId: 'm-1' })])
  assert.equal(rejected.ok, false)
})

test('open question blocks confirmation', () => {
  const r = room({ openQuestion: 'callback path?' })
  r.stages[0].state = 'active'
  const gate = gateFor(r, 0, [])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /问题/)
})

test('deliverable without an acceptance command cannot pass', () => {
  const r = room()
  delete r.stages[1].acceptance
  const gate = gateFor(r, 1, [evidence()])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /验收命令/)
})

test('deliverable without evidence cannot pass', () => {
  const gate = gateFor(room(), 1, [])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /证据/)
})

test('a failed command exit cannot be signed off', () => {
  const gate = gateFor(room({ verifiers: [] }), 1, [evidence(1, 10, { exit: 1 })])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /exit 0/)
})

test('a turn summary is not command evidence', () => {
  const gate = gateFor(room({ verifiers: [] }), 1, [evidence(1, 10, { kind: 'turn', exit: undefined })])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /验收命令/)
})

test('evidence must match the stage acceptance command', () => {
  const gate = gateFor(room({ verifiers: [] }), 1, [evidence(1, 10, { command: 'echo ok' })])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /验收命令/)
})

test('a PASS must reference exit 0 command evidence', () => {
  const gate = gateFor(room(), 1, [
    evidence(1, 10, { exit: 1 }),
    verdict(1, 11, true, { evidenceId: 'e-10' }),
  ])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /exit 0/)
})

test('live deliverable needs a verifier PASS', () => {
  const gate = gateFor(room(), 1, [evidence()])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /PASS/)
})

test('multiple verifiers must all PASS the same evidence before sign-off', () => {
  const r = room({ verifiers: ['v1', 'v2'], seatNames: { v1: '验收一', v2: '验收二' } })
  const e = evidence(1, 10)
  const pending = gateFor(r, 1, [e, verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1')])
  assert.equal(pending.ok, false)
  assert.match(pending.error, /验收二/)
  const passed = gateFor(r, 1, [
    e,
    verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1'),
    verdict(1, 12, true, { evidenceId: 'e-10' }, 'v2'),
  ])
  assert.equal(passed.ok, true)
})

test('a newer failed command invalidates earlier multi-verifier PASSes', () => {
  const r = room({ verifiers: ['v1', 'v2'], seatNames: { v1: '验收一', v2: '验收二' } })
  const gate = gateFor(r, 1, [
    evidence(1, 10),
    verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1'),
    verdict(1, 12, true, { evidenceId: 'e-10' }, 'v2'),
    evidence(1, 13, { exit: 1 }),
  ])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /没有通过/)
})

test('one verifier REJECT blocks sign-off even if the other PASSed', () => {
  const r = room({ verifiers: ['v1', 'v2'], seatNames: { v1: '验收一', v2: '验收二' } })
  const gate = gateFor(r, 1, [
    evidence(1, 10),
    verdict(1, 11, true, { evidenceId: 'e-10' }, 'v1'),
    verdict(1, 12, false, { evidenceId: 'e-10' }, 'v2'),
  ])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /验收一|验收二/)
})

test('a manual stage waits for the product before sign-off', () => {
  const r = room()
  r.stages[1] = { title: 'docs', kind: 'decision', state: 'active', manual: true }
  assert.equal(gateFor(r, 1, []).ok, false)
  assert.match(gateFor(r, 1, []).error, /还没有产出/)
  const turnEvidence = { id: 'e-1', kind: 'evidence', seq: 10, meta: { stage: 1, kind: 'turn' } }
  assert.equal(gateFor(r, 1, [turnEvidence]).ok, false)
  const manual = { id: 'e-2', kind: 'evidence', seq: 11, meta: { stage: 1, kind: 'manual', simulated: false } }
  assert.equal(gateFor(r, 1, [turnEvidence, manual]).ok, true)
})

test('a stale manual evidence does not survive a newer turn', () => {
  const r = room()
  r.stages[1] = { title: 'docs', kind: 'decision', state: 'active', manual: true }
  const manual = { id: 'm-1', kind: 'evidence', seq: 10, meta: { stage: 1, kind: 'manual' } }
  const turn = { id: 't-1', kind: 'evidence', seq: 11, meta: { stage: 1, kind: 'turn' } }
  assert.equal(gateFor(r, 1, [manual, turn]).ok, false)
  const fresh = { id: 'm-2', kind: 'evidence', seq: 12, meta: { stage: 1, kind: 'manual' } }
  assert.equal(gateFor(r, 1, [manual, turn, fresh]).ok, true)
})

test('a room without verifiers is signed off by the human on evidence', () => {
  const gate = gateFor(room({ verifiers: [] }), 1, [evidence()])
  assert.equal(gate.ok, true)
  assert.equal(gate.stage.title, 'impl')
})

test('a room without verifiers still needs evidence before sign-off', () => {
  const gate = gateFor(room({ verifiers: [] }), 1, [])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /证据/)
})

test('a room without verifiers with a REJECT must rework', () => {
  const gate = gateFor(room({ verifiers: [] }), 1, [evidence(1, 10), verdict(1, 11, false)])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /返工/)
})

test('a human rework invalidates an earlier PASS', () => {
  const rework = { id: 'r-1', kind: 'rework', authorId: 'you', seq: 12, meta: { stage: 1 } }
  const gate = gateFor(room(), 1, [evidence(1, 10), verdict(1, 11, true), rework])
  assert.equal(gate.ok, false)
  assert.match(gate.error, /证据|PASS/)
})

test('latest PASS with evidence passes', () => {
  const gate = gateFor(room(), 1, [evidence(1, 10), verdict(1, 11, true)])
  assert.equal(gate.ok, true)
  assert.equal(gate.stage.title, 'impl')
})

test('a REJECT is superseded by new evidence and a new PASS', () => {
  const messages = [
    evidence(1, 10),
    verdict(1, 11, false),
    evidence(1, 12),
    verdict(1, 13, true),
  ]
  const gate = gateFor(room(), 1, messages)
  assert.equal(gate.ok, true)
})

test('after REJECT, old evidence does not count', () => {
  const messages = [evidence(1, 10), verdict(1, 11, false), verdict(1, 12, true)]
  const gate = gateFor(room(), 1, messages)
  assert.equal(gate.ok, false)
  assert.match(gate.error, /新的证据/)
})

test('demo rooms accept simulated evidence only with PASS', () => {
  const r = room({ demo: true })
  const simulated = evidence(1, 10, { simulated: true })
  const gate = gateFor(r, 1, [simulated, verdict(1, 11, true)])
  assert.equal(gate.ok, true)
})
