import assert from 'node:assert/strict'
import test from 'node:test'
import { canCreateSubroom, childResultText, childVerdictsOf, settleCompletedSubrooms } from './rooms/studio/subrooms.js'
import { withAssignments } from './testing/room.js'

test('only a studio below the depth limit can create a subroom', () => {
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'active', depth: 0 }), true)
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'active', depth: 2 }), true)
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'active', depth: 3 }), false)
  assert.equal(canCreateSubroom({ roomType: 'chat', state: 'active', depth: 0 }), false)
  assert.equal(canCreateSubroom({ roomType: 'studio', state: 'complete', depth: 0 }), false)
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
  assert.match(childResultText({ name: '子房' }, []), /没有 Verifier verdict/)
})

const seed = (store, over) => store.writeAssignment({
  id: 'as-1',
  roomId: 'room-1',
  stageIndex: 0,
  fromMemberId: 'lead',
  toMemberId: 'worker',
  reason: 'dispatch',
  brief: {},
  status: 'sent',
  context: {},
  flags: {},
  createdAt: 1,
  updatedAt: 1,
  ...over,
})

test('a completed subroom settles its parent assignment once', () => {
  const parent = { id: 'parent', childRoomIds: ['child'], members: [{ id: 'lead', name: 'Lead' }] }
  const child = { id: 'child', name: 'Child', state: 'complete', parentAssignmentId: 'as-child' }
  const verdict = {
    id: 'v1',
    kind: 'verdict',
    authorId: 'verifier',
    text: 'PASS\n测试通过',
    meta: { pass: true, roleKind: 'verifier', stage: 0 },
  }
  const store = withAssignments({
    readRoom: id => (id === 'parent' ? parent : id === 'child' ? child : null),
    readMessages: id => (id === 'child' ? [verdict] : []),
  })
  seed(store, { id: 'as-child', reason: 'subroom', toMemberId: null, status: 'sent' })
  assert.equal(settleCompletedSubrooms(store, 'parent'), 1)
  const settled = store.readAssignment('as-child')
  assert.equal(settled.status, 'passed')
  assert.deepEqual(settled.evidenceIds, ['v1'])
  assert.match(settled.resultText, /Child/)
  assert.equal(settleCompletedSubrooms(store, 'parent'), 0)
})

