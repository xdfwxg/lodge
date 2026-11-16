import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceStages } from './rooms/studio/service-stages.js'
import { normalizeLegacyTestRoom, withAssignments } from './testing/room.js'

test('a completed child posts only its Verifier verdicts to the parent and wakes its Planner', async () => {
  const parent = normalizeLegacyTestRoom({
    id: 'parent',
    roomType: 'studio',
    state: 'active',
    leadSeat: 'lead',
    seatNames: { lead: 'Lead' },
    childRoomIds: ['child'],
    seatSpecs: [{ id: 'lead', name: 'Lead', role: 'lead' }],
    usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
    stages: [],
  })
  const child = normalizeLegacyTestRoom({
    id: 'child',
    roomType: 'studio',
    state: 'active',
    name: 'Child',
    depth: 1,
    parentRoomId: 'parent',
    closure: 'verifying',
    members: ['verifier'],
    seatNames: { verifier: 'Verifier' },
    seatSpecs: [{ id: 'verifier', name: 'Verifier', role: 'verifier' }],
    usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
    stages: [
      { title: '交付', kind: 'deliverable', state: 'passed', acceptance: 'true' },
      { title: '验收与结论', kind: 'decision', state: 'active' },
    ],
  })
  const rooms = { parent, child }
  const messages = {
    parent: [],
    child: [
      { id: 'e1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'true', exit: 0 } },
      { id: 'v1', seq: 2, kind: 'verdict', authorId: 'verifier', text: 'PASS\n测试通过', meta: { stage: 0, pass: true, mode: 'bot', roleKind: 'verifier' } },
    ],
  }
  const sent = []
  const store = withAssignments({
    readRoom: id => rooms[id] ?? null,
    readRooms: () => [parent, child],
    readMessages: id => messages[id] ?? [],
    updateRoom: (id, mutate) => {
      const next = structuredClone(rooms[id])
      if (mutate(next) === null) return null
      rooms[id] = next
      return next
    },
    appendMessage: (id, message) => {
      const stored = { id: `${id}-${messages[id].length + 1}`, ...message }
      messages[id].push(stored)
      return stored
    },
  })
  const stages = createServiceStages({
    store,
    live: {
      isAttached: id => id === 'parent',
      sendToMember: async (id, memberId, text) => { sent.push({ id, memberId, text }); return { messageId: null } },
    },
    emit: () => {},
    completeRoom: room => ({ ...room, state: 'complete', closure: 'signed' }),
    roomFiles: { writeGoal: () => {} },
  })
  const result = stages.accept(child, { stage: 1 })
  assert.equal(result.ok, true)
  const message = messages.parent.find(item => item.kind === 'child_result')
  assert.ok(message)
  assert.match(message.text, /PASS/)
  assert.doesNotMatch(message.text, /transcript|evidence/)
  assert.equal(sent[0].id, 'parent')
  assert.equal(sent[0].memberId, 'lead')
  assert.doesNotMatch(sent[0].text, /^@/)
  assert.match(sent[0].text, /Verifier 结果/)
  assert.equal(store.readRoom('parent').childResults.length, 1)
  assert.equal(store.readRoom('parent').childResults[0].roomId, 'child')
})
