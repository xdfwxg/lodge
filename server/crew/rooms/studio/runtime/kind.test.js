import assert from 'node:assert/strict'
import test from 'node:test'
import { roomKinds } from '../../kinds.js'
import { studioKind } from './kind.js'
import { stopOf } from '../../../stop.js'

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
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier' }],
  }
  const evidence = { id: 'e1', kind: 'evidence', seq: 1, ts: 1000, meta: { stage: 0, kind: 'result' } }
  const timeout = {
    id: 't1',
    kind: 'system',
    seq: 2,
    ts: 2000,
    meta: { kind: 'review_timeout', stage: 0, verifiers: ['verifier'] },
  }
  assert.equal(stopOf(room, [evidence, timeout]).kind, 'review-timeout')
  const rework = { id: 'r1', kind: 'rework', seq: 3, ts: 3000, meta: { stage: 0 } }
  assert.equal(stopOf(room, [evidence, timeout, rework]), null)
})

test('a rework the platform already dispatched is not a card for the user', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    verifiers: ['v1'],
    members: [
      { id: 'worker', name: '执行官', role: 'worker' },
      { id: 'v1', name: '验收员', role: 'verifier' },
    ],
    // 退回之后平台已经把重做派出去了：这几秒里房间在做事，不在等人。
    assignments: [{ id: 'a1', stageIndex: 0, toMemberId: 'worker', status: 'sent', reason: 'rework' }],
  }
  const messages = [
    { id: 'e1', kind: 'evidence', seq: 1, ts: 1000, meta: { stage: 0, kind: 'result' } },
    { id: 'r1', kind: 'rework', seq: 2, ts: 1100, meta: { stage: 0 } },
    { id: 'e2', kind: 'evidence', seq: 3, ts: 1200, meta: { stage: 0, kind: 'result' } },
    { id: 'v1-r', kind: 'verdict', authorId: 'v1', seq: 4, ts: 1300, meta: { stage: 0, pass: false, evidenceId: 'e2' } },
  ]
  assert.equal(stopOf(room, messages), null)
  // 返工账已经落下：就算派工还没建出来，也不是“待人”——返工已经派给执行官了。
  assert.equal(stopOf({ ...room, assignments: [] }, messages), null)
  // 退回之后返工账没落下（路由没走通），才是需要人处理的“待重做”。
  const unrouted = messages.filter(message => message.kind !== 'rework')
  assert.equal(stopOf({ ...room, assignments: [] }, unrouted)?.kind, 'rework')
})

test('a repeated review timeout names the verifier once', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier' }],
  }
  const evidence = { id: 'e1', kind: 'evidence', seq: 1, ts: 1000, meta: { stage: 0, kind: 'result' } }
  const timeout = {
    id: 't1',
    kind: 'system',
    seq: 2,
    ts: 2000,
    meta: { kind: 'review_timeout', stage: 0, verifiers: ['verifier', 'verifier'] },
  }
  assert.equal(stopOf(room, [evidence, timeout]).label, '验收员的复核没按时回来')
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

test('a finished review is shown even when a member is still marked busy', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier' }],
    busyMembers: ['verifier'],
  }
  const timeout = {
    id: 't1',
    kind: 'system',
    seq: 2,
    ts: 2000,
    meta: { kind: 'review_timeout', stage: 0, verifiers: ['verifier'] },
  }
  const need = stopOf(room, [timeout])
  assert.equal(need?.kind, 'review-timeout')
  assert.equal(need?.label, '验收员的复核没按时回来')
})

test('a review that never got a valid verdict says so in its own words', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    members: [{ id: 'verifier', name: '验收员', role: 'verifier' }],
    busyMembers: ['verifier'],
  }
  const timeout = {
    id: 't1',
    kind: 'system',
    seq: 2,
    ts: 2000,
    meta: { kind: 'review_timeout', stage: 0, verifiers: ['verifier'], reason: 'invalid' },
  }
  const need = stopOf(room, [timeout])
  assert.equal(need?.kind, 'review-timeout')
  assert.equal(need?.label, '复核没有给出有效结论')
  assert.match(need?.detail ?? '', /再叫一次复核/)
})

test('a stage whose handoff failed hands the room back instead of sitting on 待处理', () => {
  // 真房（第 31 轮）：执行官的回合被基座按空转窗口停下，交接记成失败，
  // 房间只写「这一步没有交回结果；待处理」而 needsYou 是空的——人没有下一步可点。
  const room = {
    state: 'active',
    stages: [{ title: '交付证明', kind: 'deliverable', state: 'active' }],
    members: [
      { id: 'executor', name: '执行官', role: 'worker' },
      { id: 'verifier', name: '验收员', role: 'verifier' },
    ],
    assignments: [{
      id: 'a1',
      stageIndex: 0,
      toMemberId: 'executor',
      reason: 'dispatch',
      status: 'failed',
      createdAt: 1000,
    }],
  }
  const need = stopOf(room, [])
  assert.equal(need?.kind, 'blocked')
  assert.equal(need?.stage, 0)
  assert.equal(need?.label, '执行官这一回合没有跑完')
  assert.match(need?.detail ?? '', /再派一次/)

  // 有了这一步的结果就不再催：交接失败只说明这一拍没交回。
  const evidence = { id: 'e1', kind: 'evidence', seq: 1, ts: 2000, meta: { stage: 0, kind: 'result' } }
  assert.notEqual(stopOf(room, [evidence])?.kind, 'blocked')
})

test('a review that never started says so instead of "the verifier is looking"', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    verifiers: ['v1'],
    members: [
      { id: 'worker', name: '执行官', role: 'worker' },
      { id: 'v1', name: '验收员', role: 'verifier' },
    ],
    assignments: [{ id: 'a1', stageIndex: 0, toMemberId: 'worker', status: 'reported', reason: 'dispatch' }],
  }
  const evidence = { id: 'e1', kind: 'evidence', seq: 1, ts: 1000, meta: { stage: 0, kind: 'result' } }
  // 有结果、没有判定、也没有任何复核交接在外面：这不是“在看”，是“没开始”。
  const need = stopOf(room, [evidence])
  assert.equal(need?.kind, 'review-timeout')
  assert.equal(need?.label, '复核没有开始')

  // 复核真的派出去了才算“在看”。
  const reviewing = {
    ...room,
    assignments: [...room.assignments, { id: 'a2', stageIndex: 0, toMemberId: 'v1', status: 'sent', reason: 'review' }],
  }
  // 复核真的在跑时不是一张卡：平台手上还有活。
  assert.equal(stopOf(reviewing, [evidence]), null)
})

test('a result that just landed does not flash "review never started"', () => {
  const room = {
    state: 'active',
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    verifiers: ['v1'],
    members: [{ id: 'worker', name: '执行官', role: 'worker' }, { id: 'v1', name: '验收员', role: 'verifier' }],
    assignments: [{ id: 'a1', stageIndex: 0, toMemberId: 'worker', status: 'reported', reason: 'dispatch' }],
  }
  const fresh = { id: 'e1', kind: 'evidence', seq: 1, ts: Date.now(), meta: { stage: 0, kind: 'result' } }
  // 结果刚落地、复核请求还在路上：宽限窗内不制造假停。
  assert.equal(stopOf(room, [fresh]), null)
  // 过了宽限窗还没人接手，才如实说“复核没开始”。
  const stale = { ...fresh, ts: Date.now() - 30_000 }
  assert.equal(stopOf(room, [stale])?.label, '复核没有开始')
})
