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
    { title: '目标对齐', kind: 'decision', spine: true, state: 'passed' },
    { title: 'impl', kind: 'deliverable', state: 'active', deliverable: '把事做完' },
  ],
  ...over,
})

const dispatchAssignment = flags => ({
  id: 'as-1',
  stageIndex: 1,
  toMemberId: 'worker',
  reason: 'dispatch',
  status: 'working',
  context: { parallel: true },
  flags,
})

const evidence = (seq = 10) => ({ id: 'e-10', kind: 'evidence', seq, meta: { stage: 1, kind: 'result' } })
const verdict = (pass, seq = 11, authorId = 'verifier') => ({ id: `v-${seq}-${authorId}`, kind: 'verdict', authorId, seq, meta: { stage: 1, pass, evidenceId: 'e-10' } })

test('an active spine decision is progress, not a human decision', () => {
  const r = room({ stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: 'active' }] })
  assert.equal(roomNeedsYou(r, []), null)
})

test('an open question outranks the stage type', () => {
  assert.equal(roomNeedsYou(room({ openQuestion: 'which path?' }), []).kind, 'question')
})

test('a lost base connection and a timed-out stage both ask the human', () => {
  const lost = room()
  lost.live = true
  lost.connectionError = '基座连接中断：timeout'
  assert.deepEqual(roomNeedsYou(lost, []), {
    kind: 'connection',
    stage: null,
    label: '连接断了',
    detail: '模型服务掉线了；Lodge 会自动重连，也可以点重试。',
  })
  const blocked = room()
  blocked.blocked = { stage: 1, reason: 'timeout' }
  assert.deepEqual(roomNeedsYou(blocked, []), {
    kind: 'blocked',
    stage: 1,
    label: '执行超时',
    detail: '退回重做，或叫停后重新派活。',
  })
  blocked.blocked.reason = 'boundary'
  assert.equal(roomNeedsYou(blocked, []).label, '越界改动没能退回')
  // 没登记的理由不糊弄成“执行超时”：如实说停住了。
  blocked.blocked.reason = 'something-new'
  assert.equal(roomNeedsYou(blocked, []).label, '这一步停住了')
})

test('a member stopped for reading someone else’s copy is not a human decision', () => {
  const r = room()
  // 平台停的是这一位成员，接着用其余人的结果走；把它做成待办会让人等一件已经在发生的事。
  r.blocked = { stage: 1, reason: 'read-boundary', members: ['worker'] }
  assert.equal(roomNeedsYou(r, []), null)
})

test('a busy member is not a needs-you state', () => {
  assert.equal(roomNeedsYou(room({ busyMembers: ['worker'] }), []), null)
})

test('a pending external approval outranks a busy member', () => {
  const r = room()
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

test('a budget pause names the round budget', () => {
  assert.deepEqual(roomNeedsYou({ state: 'paused', pauseReason: 'budget' }, []), {
    kind: 'budget',
    stage: null,
    label: '这一轮的额度用完了',
    detail: '充值或调高预算后，点“继续”。',
  })
})

test('multiple verifiers report progress and require all PASS', () => {
  const r = room()
  r.members = [...r.members.filter(item => item.roleKind !== 'verifier'), member('v1', '验收一', 'verifier', 'verifier'), member('v2', '验收二', 'verifier', 'verifier')]
  assert.deepEqual(roomNeedsYou(r, [evidence(), verdict(true, 11, 'v1')]), { kind: 'review-timeout', stage: 1, label: '复核没有开始', detail: '可以再叫一次复核，或退回重做。' })
  assert.equal(roomNeedsYou(r, [evidence(), verdict(true, 11, 'v1'), verdict(true, 12, 'v2')]).kind, 'signoff')
  assert.equal(roomNeedsYou(r, [evidence(), verdict(true, 11, 'v1'), verdict(false, 12, 'v2')]).kind, 'rework')
})

test('a PASS verdict is progress, a REJECT asks for rework', () => {
  assert.equal(roomNeedsYou(room(), [evidence(), verdict(true)]).kind, 'signoff')
  assert.equal(roomNeedsYou(room(), [evidence(), verdict(false)]).kind, 'rework')
})

test('a planner handoff asks the human instead of showing rework', () => {
  const r = room()
  const reject = verdict(false, 13)
  const needs = roomNeedsYou({
    ...r,
    lastPlannerDecision: {
      stage: 1,
      verdictId: reject.id,
      kind: 'human',
      judgment: { reason: '缺真实版本号', actionRequired: '请给出版本号和发布日期' },
    },
  }, [evidence(), reject])
  assert.equal(needs.kind, 'decision')
  assert.match(needs.label, /交给你/)
  assert.match(needs.detail, /版本号/)
})

test('result evidence with no review out says the review never started', () => {
  // 有结果、没有判定、也没有复核交接在外面：说“验收员在看”就是骗人。
  assert.equal(roomNeedsYou(room(), [evidence()]).kind, 'review-timeout')
  assert.equal(roomNeedsYou(room(), [evidence()]).label, '复核没有开始')
})

test('recent executor activity hides a stale review status', () => {
  const activity = { kind: 'activity', authorId: 'worker', ts: Date.now() }
  assert.equal(roomNeedsYou(room(), [evidence(), activity]), null)
  assert.equal(
    roomNeedsYou({ ...room(), turnQueue: [{ memberId: 'worker', state: 'running' }] }, [evidence()]),
    null,
  )
  const old = { ...activity, ts: Date.now() - 3 * 60_000 }
  assert.equal(roomNeedsYou(room(), [evidence(), old]).kind, 'review-timeout')
})

test('recent activity does not hide a planner handoff', () => {
  const reject = verdict(false, 13)
  const activity = { kind: 'activity', authorId: 'verifier', ts: Date.now() }
  const needs = roomNeedsYou({
    ...room(),
    lastPlannerDecision: {
      stage: 1,
      verdictId: reject.id,
      kind: 'human',
      judgment: { reason: '缺真实版本号', actionRequired: '请给出版本号和发布日期' },
    },
  }, [evidence(), reject, activity])
  assert.equal(needs.kind, 'decision')
  assert.match(needs.detail, /版本号/)
})

test('a timed-out or stalled parallel assignment asks the human', () => {
  const timedOut = room({ assignments: [dispatchAssignment({ timedOut: true })] })
  assert.deepEqual(roomNeedsYou(timedOut, []), {
    kind: 'parallel',
    stage: 1,
    label: '执行官并行执行超时',
    detail: '退回重做，或只留一位执行官继续。',
  })
  const stalled = room({ assignments: [dispatchAssignment({ stalled: true })] })
  assert.deepEqual(roomNeedsYou(stalled, []), {
    kind: 'parallel',
    stage: 1,
    label: '执行官卡住了，没有产出',
    detail: '退回重做，或只留一位执行官继续。',
  })
})

test('a room-level merge conflict outlives the dispatch record', () => {
  assert.deepEqual(roomNeedsYou(room({ mergeConflict: { stage: 1, files: ['same.txt'] } }), []), {
    kind: 'merge',
    stage: 1,
    label: '合并冲突',
  })
})

test('a room without a verifier asks nothing of the human', () => {
  const r = room()
  r.members = r.members.filter(member => member.roleKind !== 'verifier')
  assert.equal(roomNeedsYou(r, [evidence()]), null)
})

test('complete, paused and stopped rooms are quiet', () => {
  for (const state of ['complete', 'paused', 'stopped']) {
    assert.equal(roomNeedsYou(room({ state }), []), null)
  }
})

test('an idle pause asks the human to speak', () => {
  assert.deepEqual(roomNeedsYou(room({ state: 'paused', idle: true }), []), { kind: 'idle', stage: null, label: '可以接着聊' })
  assert.equal(roomNeedsYou(room({ state: 'paused', idle: false }), []), null)
})

test('the inbox holds only this room', () => {
  const items = roomAttention(room(), [evidence()])
  assert.equal(items.length, 1)
  assert.deepEqual(items[0], { kind: 'review-timeout', stage: 1, label: '复核没有开始', detail: '可以再叫一次复核，或退回重做。' })
})

test('a question card from an earlier stage no longer asks', () => {
  const stale = { kind: 'question', seq: 2, meta: { card: { requestId: 'req-old', requestType: 'permission', scope: { stage: 0, floor: -1 } } } }
  assert.equal(roomNeedsYou(room(), [stale]), null)
  const fresh = { kind: 'question', seq: 2, meta: { card: { requestId: 'req-new', requestType: 'permission', scope: { stage: 1, floor: -1 } } } }
  assert.equal(roomNeedsYou(room(), [fresh]).kind, 'approval')
})

test('a question card from an earlier rework round no longer asks', () => {
  const messages = [
    { kind: 'rework', seq: 4, meta: { stage: 1 } },
    { kind: 'question', seq: 5, meta: { card: { requestId: 'req-old', requestType: 'permission', scope: { stage: 1, floor: -1 } } } },
  ]
  assert.equal(roomNeedsYou(room(), messages), null)
  const current = { kind: 'question', seq: 6, meta: { card: { requestId: 'req-new', requestType: 'permission', scope: { stage: 1, floor: 4 } } } }
  assert.equal(roomNeedsYou(room(), [...messages, current]).kind, 'approval')
})

test('an approval from an earlier stage no longer asks', () => {
  const r = room()
  r.approvals = [{ id: 'a', state: 'pending', scope: { stage: 0, floor: -1 } }]
  assert.notEqual(roomNeedsYou(r, [])?.kind, 'approval')
  r.approvals = [{ id: 'a', state: 'pending', scope: { stage: 1, floor: -1 } }]
  assert.equal(roomNeedsYou(r, []).kind, 'approval')
})

test('a question card already answered on the room no longer asks', () => {
  const card = { kind: 'question', seq: 1, meta: { card: { requestId: 'req-1', requestType: 'permission' } } }
  assert.equal(roomNeedsYou(room(), [card]).kind, 'approval')
  assert.equal(roomNeedsYou(room({ cardAnswers: ['req-1'] }), [card]), null)
})

test('an open decision card asks the user with the planner question', () => {
  const r = room()
  r.pendingDecision = {
    id: 'd1', status: 'open', stage: 0, question: '走哪条路？',
    options: [{ id: 'a', title: 'A', effect: 'A' }, { id: 'b', title: 'B', effect: 'B' }],
    recommended: 'a',
  }
  assert.deepEqual(roomNeedsYou(r, []), {
    kind: 'decision', stage: 0, label: '走哪条路？', detail: '选一条路继续。', decisionId: 'd1',
  })
})
