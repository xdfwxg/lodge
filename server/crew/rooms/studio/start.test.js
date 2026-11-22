import assert from 'node:assert/strict'
import test from 'node:test'
import { startInitialStage } from './start.js'

test('a direct studio dispatch projects the @ handoff into the room', async () => {
  const room = {
    id: 'room-1',
    goal: '改标题',
    state: 'active',
    stages: [{ title: '改标题', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', name: '规划师' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: '执行官' } },
    ],
    plan: null,
    constraints: [],
  }
  const messages = []
  const store = {
    readRoom: () => room,
    readMessages: () => messages,
    appendMessage: (_roomId, message) => { messages.push(message); return message },
    updateRound: () => room,
  }
  const sent = []
  const live = {
    sendToMember: async (roomId, memberId, prompt, options) => {
      sent.push({ roomId, memberId, prompt, options })
      return { messageId: null }
    },
  }
  await startInitialStage({
    store,
    live,
    room,
    plan: null,
    align: false,
    workers: [room.members[1]],
    lead: room.members[0],
    worker: room.members[1],
    roster: room.members,
    goal: room.goal,
    verify: 'test',
    acceptance: 'npm test',
  })
  assert.equal(sent[0].memberId, 'executor')
  const handoff = messages.find(message => message.meta?.kind === 'handoff')
  assert.equal(handoff.text, '@执行官 第 1 步「改标题」交给你。')
  assert.deepEqual(handoff.meta.to, ['executor'])
})
