import assert from 'node:assert/strict'
import test from 'node:test'
import { roomNeedsYou } from './attention.js'

const member = (id, name, role, roleKind) => ({ id, name, role, roleKind, permissions: {}, toolSurface: [], skills: [], mcp: [], body: { kind: 'base', ref: `bot-${id}`, name } })
const room = (over = {}) => ({
  state: 'active',
  busy: false,
  members: [member('planner', '规划师', 'lead', 'planner'), member('worker', '执行官', 'worker', 'executor'), member('verifier', '验收员', 'verifier', 'verifier')],
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

const dispatchAssignment = flags => ({
  id: 'as-1',
  stageIndex: 1,
  toMemberId: 'worker',
  reason: 'dispatch',
  status: 'working',
  context: { parallel: true },
  flags,
})

const evidence = (seq = 10) => ({ kind: 'evidence', seq, meta: { stage: 1, kind: 'command', exit: 0 } })
const verdict = (pass, seq = 11) => ({ kind: 'verdict', seq, meta: { stage: 1, pass } })

test('active decision waits for the human', () => {
  assert.deepEqual(roomNeedsYou(room(), []), { kind: 'decision', stage: 0, label: '待确认' })
})

test('an open question outranks the stage type', () => {
  assert.equal(roomNeedsYou(room({ openQuestion: 'which path?' }), []).kind, 'question')
})

test('a busy member is not a needs-you state', () => {
  assert.equal(roomNeedsYou(room({ busy: true }), []), null)
})

test('a pending external approval outranks a busy member', () => {
  const r = atDeliverable()
  r.busy = true
  r.approvals = [{ id: 'a', state: 'pending' }]
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'approval', stage: null, label: '待确认' })
})

test('a member engine error asks the human to intervene with a concrete reason', () => {
  assert.deepEqual(roomNeedsYou({
    state: 'paused',
    pauseReason: 'member_error',
    members: [member('worker', '执行者', 'worker', 'executor')],
    memberError: { memberId: 'worker', kind: 'quota' },
  }, []), {
    kind: 'error',
    stage: null,
    label: '执行者的模型额度不够',
  })
  assert.equal(roomNeedsYou({
    state: 'paused',
    pauseReason: 'member_error',
    members: [member('verifier', '验收员', 'verifier', 'verifier')],
    memberError: { memberId: 'verifier', kind: 'auth' },
  }, []).label, '验收员的登录失效了')
})

test('a deliverable without an acceptance command asks for setup', () => {
  const r = atDeliverable()
  r.stages[1].acceptance = ''
  assert.equal(roomNeedsYou(r, []).kind, 'setup')
})

test('multiple verifiers report progress and require all PASS', () => {
  const r = atDeliverable()
  r.members = [...r.members.filter(item => item.roleKind !== 'verifier'), member('v1', '验收一', 'verifier', 'verifier'), member('v2', '验收二', 'verifier', 'verifier')]
  const e = { id: 'e-10', kind: 'evidence', seq: 10, meta: { stage: 1, kind: 'command', command: 'npm test', exit: 0 } }
  const first = { id: 'v-1', kind: 'verdict', authorId: 'v1', seq: 11, meta: { stage: 1, pass: true, evidenceId: 'e-10' } }
  const second = { id: 'v-2', kind: 'verdict', authorId: 'v2', seq: 12, meta: { stage: 1, pass: true, evidenceId: 'e-10' } }
  assert.deepEqual(roomNeedsYou(r, [e, first]), { kind: 'review', stage: 1, label: '验收员在看 · 已回 1/2' })
  assert.equal(roomNeedsYou(r, [e, first, second]).kind, 'signoff')
  const reject = { ...second, meta: { ...second.meta, pass: false } }
  assert.equal(roomNeedsYou(r, [e, first, reject]).kind, 'rework')
})

test('a failed acceptance command asks for rework, not review or sign-off', () => {
  const failed = { id: 'e-failed', kind: 'evidence', seq: 10, meta: { stage: 1, kind: 'command', command: 'npm test', exit: 1 } }
  assert.equal(roomNeedsYou(atDeliverable(), [failed]).kind, 'rework')
  const two = atDeliverable()
  two.members = [...two.members, member('v1', '验收一', 'verifier', 'verifier'), member('v2', '验收二', 'verifier', 'verifier')]
  assert.equal(roomNeedsYou(two, [failed]).kind, 'rework')
  two.members = two.members.filter(member => member.roleKind !== 'verifier')
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
  assert.deepEqual(roomNeedsYou(r, [manual]), { kind: 'review', stage: 1, label: '验收员在看 · 已回 0/1' })
  r.members = r.members.filter(member => member.roleKind !== 'verifier')
  assert.deepEqual(roomNeedsYou(r, [manual]), { kind: 'decision', stage: 1, label: '待确认' })
})

test('a timed-out parallel assignment asks the human', () => {
  const r = atDeliverable()
  r.assignments = [dispatchAssignment({ timedOut: true })]
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'parallel', stage: 1, label: '并行执行超时' })
})

test('a stalled parallel assignment asks the human', () => {
  const r = atDeliverable()
  r.assignments = [dispatchAssignment({ stalled: true })]
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'parallel', stage: 1, label: '并行执行无产出' })
})

test('a room-level merge conflict outlives the dispatch record', () => {
  const r = atDeliverable()
  r.mergeConflict = { stage: 1, files: ['same.txt'] }
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'merge', stage: 1, label: '合并冲突' })
})

test('a room with no verifier waits for sign-off after evidence', () => {
  const r = atDeliverable()
  r.members = r.members.filter(member => member.roleKind !== 'verifier')
  assert.equal(roomNeedsYou(r, [evidence()]).kind, 'signoff')
})

test('complete, paused and stopped rooms are quiet', () => {
  for (const state of ['complete', 'paused', 'stopped']) {
    assert.equal(roomNeedsYou(room({ state }), []), null)
  }
})

test('an idle pause asks the human to speak', () => {
  const r = room({ state: 'paused', idle: true })
  assert.deepEqual(roomNeedsYou(r, []), { kind: 'idle', stage: null, label: '可以接着聊' })
})

test('a manual pause stays quiet', () => {
  assert.equal(roomNeedsYou(room({ state: 'paused', idle: false }), []), null)
})
