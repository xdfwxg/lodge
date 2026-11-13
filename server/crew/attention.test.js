import assert from 'node:assert/strict'
import test from 'node:test'
import { roomNeedsYou } from './attention.js'

const room = (over = {}) => ({
  state: 'active',
  busy: false,
  verifiers: ['verifier'],
  openQuestion: null,
  stages: [
    { title: 'align', kind: 'decision', state: 'active', acceptance: undefined },
    { title: 'impl', kind: 'deliverable', state: 'pending', acceptance: 'npm test' },
  ],
  ...over,
})

const atDeliverable = () => {
  const r = room()
  r.stages[0].state = 'passed'
  r.stages[1].state = 'active'
  return r
}

const evidence = (seq = 10) => ({ kind: 'evidence', seq, meta: { stage: 1, kind: 'command', exit: 0 } })
const verdict = (pass, seq = 11) => ({ kind: 'verdict', seq, meta: { stage: 1, pass } })

test('active decision waits for the human', () => {
  assert.deepEqual(roomNeedsYou(room(), []), { kind: 'decision', stage: 0, label: '等你确认' })
})

test('an open question outranks the stage type', () => {
  assert.equal(roomNeedsYou(room({ openQuestion: 'which path?' }), []).kind, 'question')
})

test('a busy seat is not a needs-you state', () => {
  assert.equal(roomNeedsYou(room({ busy: true }), []), null)
})

test('a pending external approval outranks a busy seat', () => {
  const r = atDeliverable()
  r.busy = true
  r.approvals = [{ id: 'a', state: 'pending' }]
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'approval', stage: null, label: '等你批准外部动作' })
})

test('a budget pause asks the human to raise it', () => {
  assert.deepEqual(roomNeedsYou({ state: 'paused', pauseReason: 'budget' }, []), {
    kind: 'budget',
    stage: null,
    label: '预算已用尽 · 等你处理',
  })
})

test('a deliverable without an acceptance command asks for setup', () => {
  const r = atDeliverable()
  r.stages[1].acceptance = ''
  assert.equal(roomNeedsYou(r, []).kind, 'setup')
})

test('multiple verifiers report progress and require all PASS', () => {
  const r = atDeliverable()
  r.verifiers = ['v1', 'v2']
  r.seatNames = { v1: '验收一', v2: '验收二' }
  const e = { id: 'e-10', kind: 'evidence', seq: 10, meta: { stage: 1, kind: 'command', command: 'npm test', exit: 0 } }
  const first = { id: 'v-1', kind: 'verdict', authorId: 'v1', seq: 11, meta: { stage: 1, pass: true, evidenceId: 'e-10' } }
  const second = { id: 'v-2', kind: 'verdict', authorId: 'v2', seq: 12, meta: { stage: 1, pass: true, evidenceId: 'e-10' } }
  assert.deepEqual(roomNeedsYou(r, [e, first]), { kind: 'review', stage: 1, label: '待复核 · 已回报 1/2' })
  assert.equal(roomNeedsYou(r, [e, first, second]).kind, 'signoff')
  const reject = { ...second, meta: { ...second.meta, pass: false } }
  assert.equal(roomNeedsYou(r, [e, first, reject]).kind, 'rework')
})

test('a failed acceptance command asks for rework, not review or sign-off', () => {
  const failed = { id: 'e-failed', kind: 'evidence', seq: 10, meta: { stage: 1, kind: 'command', command: 'npm test', exit: 1 } }
  assert.equal(roomNeedsYou(atDeliverable(), [failed]).kind, 'rework')
  const two = atDeliverable()
  two.verifiers = ['v1', 'v2']
  assert.equal(roomNeedsYou(two, [failed]).kind, 'rework')
  two.verifiers = []
  assert.equal(roomNeedsYou(two, [failed]).kind, 'rework')
})

test('a PASS verdict waits for sign-off', () => {
  assert.equal(roomNeedsYou(atDeliverable(), [evidence(), verdict(true)]).kind, 'signoff')
})

test('a REJECT verdict waits for rework', () => {
  assert.equal(roomNeedsYou(atDeliverable(), [evidence(), verdict(false)]).kind, 'rework')
})

test('command evidence without a verdict waits for review', () => {
  assert.equal(roomNeedsYou(atDeliverable(), [evidence()]).kind, 'review')
})

test('a manual stage stays quiet until the product is ready', () => {
  const r = atDeliverable()
  r.stages[1] = { title: 'docs', kind: 'decision', state: 'active', manual: true }
  assert.equal(roomNeedsYou(r, []), null)
  assert.equal(roomNeedsYou(r, [evidence()]), null)
  const manual = { kind: 'evidence', seq: 12, meta: { stage: 1, kind: 'manual' } }
  assert.deepEqual(roomNeedsYou(r, [manual]), { kind: 'review', stage: 1, label: '待复核 · 已回报 0/1' })
  r.verifiers = []
  assert.deepEqual(roomNeedsYou(r, [manual]), { kind: 'decision', stage: 1, label: '等你验收' })
})

test('a parallel merge conflict asks the human', () => {
  const r = atDeliverable()
  r.stageDispatch = { stage: 1, pending: [], conflict: { files: ['same.txt'] } }
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'merge', stage: 1, label: '合并冲突 · 等你处理' })
})

test('a timed-out parallel dispatch asks the human', () => {
  const r = atDeliverable()
  r.stageDispatch = { stage: 1, pending: ['worker-2'], timedOut: true }
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'parallel', stage: 1, label: '并行执行超时 · 等你处理' })
})

test('a stalled parallel dispatch asks the human', () => {
  const r = atDeliverable()
  r.stageDispatch = { stage: 1, pending: [], stalled: true }
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'parallel', stage: 1, label: '并行执行没有产出 · 等你处理' })
})

test('a room-level merge conflict outlives the dispatch record', () => {
  const r = atDeliverable()
  r.mergeConflict = { stage: 1, files: ['same.txt'] }
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'merge', stage: 1, label: '合并冲突 · 等你处理' })
})

test('a room with no verifier waits for sign-off after evidence', () => {
  const r = atDeliverable()
  r.verifiers = []
  assert.equal(roomNeedsYou(r, [evidence()]).kind, 'signoff')
})

test('complete, paused and stopped rooms are quiet', () => {
  for (const state of ['complete', 'paused', 'stopped']) {
    assert.equal(roomNeedsYou(room({ state }), []), null)
  }
})

test('an idle pause asks the human to speak', () => {
  const r = room({ state: 'paused', idle: true })
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'idle', stage: null, label: '等你说话' })
})

test('a manual pause stays quiet', () => {
  assert.equal(roomNeedsYou(room({ state: 'paused', idle: false }), []), null)
})
