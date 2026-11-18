import assert from 'node:assert/strict'
import test from 'node:test'
import { roomAttention, roomNeedsYou } from './attention.js'

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

test('a lost base connection and a timed-out stage both ask the human', () => {
  const lost = atDeliverable()
  lost.live = true
  lost.connectionError = '基座连接中断：timeout'
  assert.deepEqual(roomNeedsYou(lost, []), {
    kind: 'connection',
    stage: null,
    label: '连接断了',
    detail: '模型服务掉线了；连上后点继续。',
  })
  const blocked = atDeliverable()
  blocked.blocked = { stage: 1, reason: 'timeout' }
  assert.deepEqual(roomNeedsYou(blocked, []), {
    kind: 'blocked',
    stage: 1,
    label: '执行超时',
    detail: '退回重做，或叫停后重新派活。',
  })
  blocked.blocked.reason = 'restart'
  assert.equal(roomNeedsYou(blocked, []).label, '重启后没接着做')
})

test('a busy member is not a needs-you state', () => {
  assert.equal(roomNeedsYou(room({ busyMembers: ['worker'] }), []), null)
})

test('a pending external approval outranks a busy member', () => {
  const r = atDeliverable()
  r.busyMembers = ['worker']
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
    label: '执行者的模型额度用完了',
    detail: '充值或给这位成员换个模型后，点“继续”。',
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
  assert.deepEqual(roomNeedsYou(r, [e, first]), { kind: 'review', stage: 1, label: '验收员在看', detail: '验收员还在核对结果。' })
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

test('a planner handoff asks the human instead of showing rework', () => {
  const r = atDeliverable()
  r.stages[1] = { title: 'docs', kind: 'deliverable', state: 'active', manual: true }
  const manual = { id: 'e-12', kind: 'evidence', seq: 12, meta: { stage: 1, kind: 'manual' } }
  const reject = { id: 'v-13', kind: 'verdict', authorId: 'verifier', seq: 13, meta: { stage: 1, pass: false } }
  const needs = roomNeedsYou({
    ...r,
    lastPlannerDecision: {
      stage: 1,
      verdictId: 'v-13',
      kind: 'human',
      judgment: { reason: '缺真实版本号', actionRequired: '请给出版本号和发布日期' },
    },
  }, [manual, reject])
  assert.equal(needs.kind, 'decision')
  assert.match(needs.label, /交给你/)
  assert.match(needs.detail, /版本号/)
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
  assert.deepEqual(roomNeedsYou(r, [manual]), { kind: 'review', stage: 1, label: '验收员在看', detail: '验收员还在核对结果。' })
  r.members = r.members.filter(member => member.roleKind !== 'verifier')
  assert.deepEqual(roomNeedsYou(r, [manual]), { kind: 'decision', stage: 1, label: '待确认' })
})

test('a timed-out parallel assignment asks the human', () => {
  const r = atDeliverable()
  r.assignments = [dispatchAssignment({ timedOut: true })]
  assert.deepEqual(roomNeedsYou(r, []), {
    kind: 'parallel',
    stage: 1,
    label: '执行官并行执行超时',
    detail: '退回重做，或只留一位执行官继续。',
  })
})

test('a stalled parallel assignment asks the human', () => {
  const r = atDeliverable()
  r.assignments = [dispatchAssignment({ stalled: true })]
  assert.deepEqual(roomNeedsYou(r, []), {
    kind: 'parallel',
    stage: 1,
    label: '执行官卡住了，没有产出',
    detail: '退回重做，或只留一位执行官继续。',
  })
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

test('a stopped automatic check says what the person should do now', () => {
  const r = room()
  r.autoCheck = { stage: 0, status: 'blocked', attempts: 3, maxAttempts: 3, reason: 'attempts' }
  assert.deepEqual(roomNeedsYou(r, []), {
    kind: 'auto-check',
    stage: 0,
    label: '这一步没做成，需要你决定',
  })
  r.autoCheck = { ...r.autoCheck, status: 'limit-reached', reason: 'time' }
  assert.equal(roomNeedsYou(r, []).label, '这一步还没做成，可以再试一次')
})

test('a failed automatic check asks for rework, not sign-off', () => {
  const r = room()
  r.stages = [{ title: 'manual', kind: 'deliverable', state: 'active', manual: true }]
  const messages = [
    { id: 'm1', kind: 'evidence', seq: 10, meta: { stage: 0, kind: 'manual' } },
    { id: 'c1', kind: 'evidence', seq: 11, meta: { stage: 0, kind: 'command', auto: true, exit: 1 } },
  ]
  assert.deepEqual(roomNeedsYou(r, messages), {
    kind: 'rework',
    stage: 0,
    label: '自动检查没通过，先重做',
  })
})

test('the inbox holds this room and the subrooms waiting on you', () => {
  const parent = room()
  const child = room({ id: 'child-1', name: '写欢迎语' })
  const delivered = room({ id: 'child-2', name: '已经交付', state: 'complete' })
  const items = roomAttention(parent, [], [
    { room: child, messages: [] },
    { room: delivered, messages: [] },
  ])
  assert.equal(items.length, 2)
  assert.deepEqual(items[0], { kind: 'decision', stage: 0, label: '待确认' })
  assert.equal(items[1].roomId, 'child-1')
  assert.equal(items[1].roomName, '写欢迎语')
  assert.equal(items[1].label, '待确认')
})

test('an idle room with quiet subrooms has an empty inbox', () => {
  const parent = room({ state: 'complete' })
  const child = room({ id: 'child-1', name: '写欢迎语', state: 'paused', idle: false })
  assert.deepEqual(roomAttention(parent, [], [{ room: child, messages: [] }]), [])
})

test('a question card from an earlier stage no longer asks', () => {
  const stale = { kind: 'question', seq: 2, meta: { card: { requestId: 'req-old', requestType: 'permission', scope: { stage: 0, floor: -1 } } } }
  assert.equal(roomNeedsYou(atDeliverable(), [stale]), null)
  const fresh = { kind: 'question', seq: 2, meta: { card: { requestId: 'req-new', requestType: 'permission', scope: { stage: 1, floor: -1 } } } }
  assert.equal(roomNeedsYou(atDeliverable(), [fresh]).kind, 'approval')
})

test('a question card from an earlier rework round no longer asks', () => {
  const r = atDeliverable()
  const messages = [
    { kind: 'rework', seq: 4, meta: { stage: 1 } },
    { kind: 'question', seq: 5, meta: { card: { requestId: 'req-old', requestType: 'permission', scope: { stage: 1, floor: -1 } } } },
  ]
  assert.equal(roomNeedsYou(r, messages), null)
  const current = { kind: 'question', seq: 6, meta: { card: { requestId: 'req-new', requestType: 'permission', scope: { stage: 1, floor: 4 } } } }
  assert.equal(roomNeedsYou(r, [...messages, current]).kind, 'approval')
})

test('an approval from an earlier stage no longer asks', () => {
  const r = atDeliverable()
  r.approvals = [{ id: 'a', state: 'pending', scope: { stage: 0, floor: -1 } }]
  assert.notEqual(roomNeedsYou(r, [])?.kind, 'approval')
  r.approvals = [{ id: 'a', state: 'pending', scope: { stage: 1, floor: -1 } }]
  assert.equal(roomNeedsYou(r, []).kind, 'approval')
})

test('a question card already answered on the room no longer asks', () => {
  const card = { kind: 'question', seq: 1, meta: { card: { requestId: 'req-1', requestType: 'permission' } } }
  assert.equal(roomNeedsYou(room(), [card]).kind, 'approval')
  assert.equal(roomNeedsYou(room({ cardAnswers: ['req-1'] }), [card]).kind, 'decision')
})
