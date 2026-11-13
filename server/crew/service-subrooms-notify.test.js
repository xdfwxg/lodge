import assert from 'node:assert/strict'
import test from 'node:test'
import { createServiceStages } from './service-stages.js'

test('a completed child posts only its Verifier verdicts to the parent and wakes its Planner', async () => {
  const parent = {
    id: 'parent',
    roomType: 'studio',
    state: 'active',
    leadSeat: 'lead',
    seatNames: { lead: 'Lead' },
    childRoomIds: ['child'],
    usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
    stages: [],
  }
  const child = {
    id: 'child',
    roomType: 'studio',
    state: 'active',
    name: 'Child',
    depth: 1,
    parentRoomId: 'parent',
    closure: 'verifying',
    verifiers: ['verifier'],
    seatNames: { verifier: 'Verifier' },
    usage: { costMicroUsd: 0, budgetMicroUsd: 0 },
    stages: [
      { title: '交付', kind: 'deliverable', state: 'passed', acceptance: 'true' },
      { title: '验收与结论', kind: 'decision', state: 'active' },
    ],
  }
  const rooms = { parent, child }
  const messages = {
    parent: [],
    child: [
      { id: 'e1', seq: 1, kind: 'evidence', meta: { stage: 0, kind: 'command', command: 'true', exit: 0 } },
      { id: 'v1', seq: 2, kind: 'verdict', authorId: 'verifier', text: 'PASS\n测试通过', meta: { stage: 0, pass: true, mode: 'bot', roleKind: 'verifier' } },
    ],
  }
  const sent = []
  const store = {
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
  }
  const stages = createServiceStages({
    store,
    live: {
      isAttached: id => id === 'parent',
      sendToSeat: async (id, seat, text) => { sent.push({ id, seat, text }); return { messageId: null } },
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
  assert.equal(sent[0].seat, 'lead')
  assert.match(sent[0].text, /@Lead/)
  assert.match(sent[0].text, /Verifier 结果/)
})
