import assert from 'node:assert/strict'
import test from 'node:test'
import { createLiveApprovals } from './kernel/live/approvals.js'

const setup = trust => {
  let room = {
    id: 'room-1',
    state: 'active',
    trust,
    members: [{ id: 'worker', role: 'worker', roleKind: 'executor', name: '执行', permissions: { read: true, exec: true, write: true }, toolSurface: [], skills: [], mcp: [], body: { kind: 'base', ref: 'bot-worker', name: '执行' } }],
    stages: [{ title: '实现', kind: 'deliverable', state: 'active' }],
    approvals: [],
  }
  const answered = []
  const events = []
  const messages = []
  const store = {
    readRoom: () => room,
    updateRoom: (id, mutate) => {
      const next = structuredClone(room)
      if (mutate(next) === null) return null
      room = next
      return room
    },
    appendEvent: (id, type, payload) => events.push({ type, payload }),
    appendMessage: (id, message) => messages.push(message),
  }
  const approvals = createLiveApprovals({
    store,
    engine: {
      capabilities: () => ({ approvals: true }),
      answerCard: async input => { answered.push(input); return { ok: true } },
    },
    emit: () => {},
    approvalTimeoutMs: 60_000,
  })
  const entry = {
    roomId: room.id,
    members: new Map([['worker', { sessionRef: 'thread-worker' }]]),
    answeredCards: new Set(),
    heldCards: new Map(),
    approvalTimers: new Map(),
  }
  return { approvals, entry, answered, events, messages, room: () => room }
}

test('answered cards keep only the latest batch', async () => {
  const ctx = setup('verify')
  for (let index = 0; index < 501; index += 1) {
    await ctx.approvals.answerCard({
      entry: ctx.entry,
      roomId: 'room-1',
      memberId: 'worker',
      requestId: `q${index}`,
      message: '继续',
      refresh: () => {},
    })
  }
  assert.equal(ctx.entry.answeredCards.size, 500)
  assert.equal(ctx.entry.answeredCards.has('q0'), false)
  assert.equal(ctx.entry.answeredCards.has('q500'), true)
  const context = [...ctx.messages].reverse().find(message => message.kind === 'human-context')
  assert.equal(context.text, '继续')
  assert.equal(context.meta.source, 'answer')
})

test('a room at the pending limit denies the next external action', async () => {
  const ctx = setup('verify')
  ctx.room().policy = { files: 'direct', network: 'proxy', external: 'ask' }
  ctx.room().approvals = Array.from({ length: 50 }, (_, index) => ({
    id: `approval-${index}`,
    requestId: `request-${index}`,
    memberId: 'worker',
    state: 'pending',
  }))
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'request-new', action: 'exec', tool: 'Bash', subtitle: 'git push origin main' },
  }, () => {})
  assert.deepEqual(ctx.answered.at(-1), {
    sessionRef: 'thread-worker',
    requestId: 'request-new',
    behavior: 'deny',
  })
  assert.match(ctx.messages.at(-1).text, /待确认的操作已经有 50 个/)
})

test('a room that asks about changes holds a write before answering', async () => {
  const ctx = setup('verify')
  ctx.room().policy = { files: 'confirm', network: 'proxy', external: 'auto' }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'w1', action: 'write', tool: 'Write', subtitle: 'src/a.js' },
  }, () => {})
  assert.equal(ctx.answered.length, 0)
  assert.equal(ctx.room().approvals.length, 1)
  assert.equal(ctx.room().approvals[0].kind, 'change')
  assert.equal(ctx.room().approvals[0].target, 'src/a.js')
})

test('a push is labelled as a push even when every step asks', async () => {
  const ctx = setup('verify')
  ctx.room().policy = { files: 'confirm', network: 'proxy', external: 'auto' }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'p2', action: 'exec', tool: 'Bash', subtitle: 'git push origin main' },
  }, () => {})
  assert.equal(ctx.answered.length, 0)
  assert.equal(ctx.room().approvals[0].kind, 'push')
})

test('every step asks also holds a plain command', async () => {
  const ctx = setup('verify')
  ctx.room().policy = { files: 'confirm', network: 'proxy', external: 'auto' }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'c1', action: 'exec', tool: 'Bash', subtitle: 'ls -la' },
  }, () => {})
  assert.equal(ctx.answered.length, 0)
  assert.equal(ctx.room().approvals[0].kind, 'change')
})

test('a member without read permission cannot use research tools', async () => {
  const ctx = setup('verify')
  ctx.room().members[0] = {
    ...ctx.room().members[0],
    permissions: {},
  }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'r-web', action: 'exec', tool: 'WebFetch', subtitle: 'https://example.com' },
  }, () => {})
  assert.equal(ctx.answered.at(-1).behavior, 'deny')
})

test('a delete inside the member work copy is not held', async () => {
  const ctx = setup('verify')
  ctx.room().policy = { files: 'direct', network: 'proxy', external: 'ask' }
  ctx.room().worktrees = { worker: '/tmp/lodge-test-work/worker' }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'rm1', action: 'exec', tool: 'Bash', subtitle: 'rm -rf .tmp' },
  }, () => {})
  assert.deepEqual(ctx.answered.at(-1), {
    sessionRef: 'thread-worker',
    requestId: 'rm1',
    behavior: 'allow',
  })
  assert.equal(ctx.room().approvals.length, 0)

  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'rm2', action: 'exec', tool: 'Bash', subtitle: 'rm -rf /etc' },
  }, () => {})
  assert.equal(ctx.answered.length, 1)
  assert.equal(ctx.room().approvals[0].kind, 'delete')
})

test('a room that does not ask about external actions lets a push through', async () => {
  const ctx = setup('verify')
  ctx.room().policy = { files: 'direct', network: 'proxy', external: 'auto' }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'p1', action: 'exec', tool: 'Bash', subtitle: 'git push origin main' },
  }, () => {})
  assert.deepEqual(ctx.answered.at(-1), {
    sessionRef: 'thread-worker',
    requestId: 'p1',
    behavior: 'allow',
  })
  assert.equal(ctx.room().approvals.length, 0)
})

test('read-only browser research needs a grant, not execution permission', async () => {
  const ctx = setup('verify')
  ctx.room().members = [{
    id: 'worker',
    role: 'worker',
    roleKind: 'planner',
    name: '规划师',
    permissions: { read: true },
    mcp: [{ server: 'chrome-devtools', approval: 'ask' }],
    body: { kind: 'base', ref: 'bot-worker' },
  }]
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'r-snapshot', action: 'exec', tool: 'mcp__chrome-devtools__take_snapshot' },
  }, () => {})
  assert.equal(ctx.answered.at(-1).behavior, 'allow')

  // 只读研究不算“改动”：房间选了每一步都问，看网页也不该被拦。
  ctx.room().policy = { files: 'confirm', network: 'proxy', external: 'ask' }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'r-snapshot-2', action: 'exec', tool: 'mcp__chrome-devtools__take_snapshot' },
  }, () => {})
  assert.equal(ctx.answered.at(-1).behavior, 'allow')

  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'r-click', action: 'exec', tool: 'mcp__chrome-devtools__click' },
  }, () => {})
  assert.equal(ctx.answered.at(-1).behavior, 'deny')
})

test('a member without a browser grant cannot take a snapshot', async () => {
  const ctx = setup('verify')
  ctx.room().members[0] = {
    ...ctx.room().members[0],
    permissions: { read: true },
  }
  await ctx.approvals.answerPermission(ctx.entry, 'worker', {
    card: { requestType: 'permission', requestId: 'r-snapshot', action: 'exec', tool: 'mcp__chrome-devtools__take_snapshot' },
  }, () => {})
  assert.equal(ctx.answered.at(-1).behavior, 'deny')
})

test('a question card is answered once in the member thread', async () => {
  const ctx = setup('verify')
  const result = await ctx.approvals.answerCard({
    entry: ctx.entry,
    roomId: 'room-1',
    memberId: 'worker',
    requestId: 'q1',
    message: '选 A',
    refresh: () => {},
  })
  assert.equal(result.ok, true)
  assert.deepEqual(ctx.answered[0], {
    sessionRef: 'thread-worker',
    requestId: 'q1',
    behavior: 'answer',
    message: '选 A',
  })
  assert.equal(ctx.entry.answeredCards.has('q1'), true)
  const again = await ctx.approvals.answerCard({
    entry: ctx.entry,
    roomId: 'room-1',
    memberId: 'worker',
    requestId: 'q1',
    message: '选 B',
    refresh: () => {},
  })
  assert.equal(again.ok, false)
  assert.equal(ctx.answered.length, 1)
})

