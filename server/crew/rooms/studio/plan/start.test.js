import assert from 'node:assert/strict'
import test from 'node:test'
import { startInitialStage } from './start.js'

test('a direct studio dispatch projects the @ handoff into the room', async () => {
  const room = {
    id: 'room-1',
    roomType: 'studio',
    goal: '改标题',
    state: 'active',
    stages: [{ title: '改标题', kind: 'deliverable', state: 'active' }],
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
  })
  assert.equal(sent[0].memberId, 'executor')
  const handoff = messages.find(message => message.meta?.kind === 'handoff')
  assert.equal(handoff.text, '@执行官 第 1 步「改标题」交给你。')
  assert.equal(handoff.authorId, 'planner')
  assert.equal(handoff.meta.from, 'planner')
  assert.deepEqual(handoff.meta.to, ['executor'])
})

test('a model-written @ does not replace the system handoff line', async () => {
  const room = {
    id: 'room-2',
    roomType: 'studio',
    goal: '改标题',
    state: 'active',
    stages: [{ title: '改标题', kind: 'deliverable', state: 'active' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', name: '规划师' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: '执行官' } },
    ],
    plan: null,
    constraints: [],
  }
  const messages = [{ kind: 'chat', authorId: 'planner', text: '计划写好了\n@执行官 这版你来做' }]
  const store = {
    readRoom: () => room,
    readMessages: () => messages,
    appendMessage: (_roomId, message) => { messages.push(message); return message },
    updateRound: () => room,
  }
  const live = { sendToMember: async () => ({ messageId: null }) }
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
  })
  const handoff = messages.find(message => message.meta?.kind === 'handoff')
  assert.equal(handoff.text, '@执行官 第 1 步「改标题」交给你。')
  assert.deepEqual(handoff.meta.to, ['executor'])
})

test('the alignment turn has no next baton and no handoff projection', async () => {
  const room = {
    id: 'room-3',
    roomType: 'studio',
    goal: '改标题',
    state: 'active',
    stages: [{ title: '目标对齐', kind: 'decision', state: 'active' }],
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
  const live = { sendToMember: async (roomId, memberId, prompt) => { sent.push({ roomId, memberId, prompt }); return { messageId: null } } }
  await startInitialStage({
    store,
    live,
    room,
    plan: null,
    align: true,
    workers: [room.members[1]],
    lead: room.members[0],
    worker: room.members[1],
    roster: room.members,
    goal: room.goal,
    verify: 'test',
  })
  assert.equal(sent[0].memberId, 'planner')
  assert.equal(messages.some(message => message.meta?.kind === 'handoff'), false)
})

test('an align turn records which history it was given', async () => {
  const room = {
    id: 'room-3',
    roomType: 'studio',
    goal: '改标题',
    state: 'active',
    stages: [{ title: '改标题', kind: 'deliverable', state: 'active' }],
    members: [
      { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { kind: 'base', name: '规划师' } },
      { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', body: { kind: 'base', name: '执行官' } },
    ],
    plan: null,
    constraints: [],
    workRound: { startedAt: 999 },
  }
  const messages = []
  const events = []
  const store = {
    readRoom: () => room,
    readMessages: () => messages,
    appendMessage: (_roomId, message) => { messages.push(message); return message },
    appendEvent: (roomId, type, payload) => { events.push({ roomId, type, payload }) },
    updateRound: () => room,
    searchMessages: () => [{ id: 'old-1', authorId: 'you', ts: 1, text: '上次为什么选拼音：跨平台。' }],
  }
  const sent = []
  const live = {
    sendToMember: async (roomId, memberId, prompt) => {
      sent.push({ roomId, memberId, prompt })
      return { messageId: null }
    },
  }
  await startInitialStage({
    store,
    live,
    room,
    plan: null,
    align: true,
    workers: [room.members[1]],
    lead: room.members[0],
    worker: room.members[1],
    roster: room.members,
    goal: room.goal,
    verify: 'test',
  })
  assert.match(sent[0].prompt, /相关历史（本房间，只读/)
  assert.deepEqual(events.find(event => event.type === 'history.brief')?.payload, { stage: 0, messageIds: ['old-1'] })
})
