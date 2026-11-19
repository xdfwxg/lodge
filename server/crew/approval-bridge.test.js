import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { roomNeedsYou } from './attention.js'
import { createCrewPorts } from './crew-ports.js'
import { createLiveRooms } from './rooms/base/live.js'
import { createStore } from './store.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 20))

const setup = async (options = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-approval-'))
  const store = createStore({ dataDir: join(dir, 'db') })
  const room = {
    id: 'room-1',
    kind: 'room',
    name: '审批房间',
    goal: '验证外部动作审批',
    state: 'active',
    live: true,
    repoPath: dir,
    sourceRepo: dir,
    workspace: { provider: options.provider ?? 'git', capabilities: {} },
    stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
    members: [{
      id: 'worker',
      name: '执行',
      role: options.role ?? 'worker',
      roleKind: options.roleKind ?? 'executor',
      permissions: options.permissions ?? { read: true, exec: true, write: true },
      toolSurface: ['read', 'exec', 'write'],
      skills: [],
      mcp: options.mcp ?? [],
      body: { kind: 'base', ref: 'bot-worker', name: '执行', roomRef: 'base-1', sessionRef: 'thread-1' },
    }],
    usage: { turns: 0, costMicroUsd: 0 },
  }
  store.writeRoom(room)
  const answers = []
  let onEvent = null
  let roomsFailure = null
  let history = options.history ?? []
  const engine = {
    capabilities: () => ({ approvals: true, streaming: true, provisioning: true, mentions: true }),
    rooms: async () => {
      if (roomsFailure !== null) throw roomsFailure
      return [{
      id: 'base-1',
      name: '执行',
      sessionRef: 'thread-1',
      working: false,
      usage: { turns: 0, costMicroUsd: 0, tokens: {} },
    }]
    },
    history: async () => ({ messages: history }),
    subscribe: ({ onEvent: handler }) => {
      onEvent = handler
      return () => {}
    },
    answerCard: async answer => {
      answers.push(answer)
      return { ok: true }
    },
    sendTurn: async () => ({ accepted: true }),
  }
  const live = createLiveRooms({
    store,
    engine,
    emit: () => {},
      ports: createCrewPorts(),
    approvalTimeoutMs: options.approvalTimeoutMs,
    retryMs: options.retryMs,
    startAttempts: options.startAttempts,
  })
  await live.attach(store.readRoom('room-1'))
  return {
    dir,
    store,
    live,
    engine,
    answers,
    failRooms: error => { roomsFailure = error },
    setHistory: messages => { history = messages },
    room: () => store.readRoom('room-1'),
    permission: (subtitle, cardOverrides = {}) => {
      const requestId = `req-${Math.random()}`
      onEvent({
        type: 'message',
        message: {
          id: `msg-${Math.random()}`,
          card: {
            requestType: 'permission',
            requestId,
            tool: 'Bash',
            action: 'exec',
            subtitle,
            options: [],
            ...cardOverrides,
          },
        },
      })
      return requestId
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}

test('a browser MCP read is answered without holding it', async () => {
  const ctx = await setup({
    mcp: [{ server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }],
  })
  try {
    const requestId = ctx.permission('打开航班页面', {
      tool: 'mcp__chrome-devtools__navigate_page',
      action: 'exec',
    })
    await tick()
    assert.deepEqual(ctx.answers.at(-1), { sessionRef: 'thread-1', requestId, behavior: 'allow' })
    assert.equal((ctx.room().approvals ?? []).length, 0)
  } finally {
    ctx.close()
  }
})

test('the same member still asks for non-browser external actions', async () => {
  const ctx = await setup({
    mcp: [{ server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }],
  })
  try {
    ctx.permission('git push', { tool: 'Bash', action: 'exec' })
    await tick()
    assert.equal((ctx.room().approvals ?? []).filter(item => item.state === 'pending').length, 1)
  } finally {
    ctx.close()
  }
})

test('a permission card from replayed history is not put back into the room', async () => {
  const ctx = await setup()
  try {
    ctx.live.detach('room-1')
    ctx.setHistory([{
      id: 'msg-old',
      at: Date.now() - 1000,
      kind: 'question',
      authorRef: 'base-1',
      text: '允许运行 echo？',
      card: {
        requestType: 'permission',
        requestId: 'req-old',
        tool: 'Bash',
        action: 'exec',
        subtitle: 'echo hi',
        options: [],
      },
    }])
    await ctx.live.attach(ctx.room())
    const messages = ctx.store.readMessages('room-1')
    assert.equal(messages.some(message => message.kind === 'question'), false)
    assert.equal(roomNeedsYou(ctx.room(), messages), null)
  } finally {
    ctx.close()
  }
})

test('a permission card already stored before a restart is marked answered', async () => {
  const ctx = await setup()
  try {
    ctx.store.appendMessage('room-1', {
      kind: 'question',
      authorId: 'worker',
      ts: 1,
      text: '允许运行 echo？',
      meta: {
        card: {
          requestType: 'permission',
          requestId: 'req-stored',
          tool: 'Bash',
          action: 'exec',
          subtitle: 'echo hi',
          options: [],
        },
      },
    })
    ctx.live.detach('room-1')
    await ctx.live.attach(ctx.room())
    const messages = ctx.store.readMessages('room-1')
    assert.ok(messages.some(message => (
      message.kind === 'system' &&
      message.meta?.kind === 'card-answered' &&
      message.meta?.requestId === 'req-stored'
    )))
    assert.equal(roomNeedsYou(ctx.room(), messages), null)
  } finally {
    ctx.close()
  }
})

test('a permission card the base no longer waits for is taken down quietly', async () => {
  const ctx = await setup()
  try {
    ctx.engine.answerCard = async () => {
      throw new Error('nothing is waiting for this request')
    }
    const requestId = ctx.permission('echo hi')
    await tick()
    assert.ok((ctx.room().cardAnswers ?? []).includes(requestId))
    assert.ok(!ctx.store.readMessages('room-1').some(message => message.text.includes('有一步确认没能处理')))
  } finally {
    ctx.close()
  }
})

test('concurrent attach reuses one live entry, and a failed attach leaves no half entry', async () => {
  const ctx = await setup()
  try {
    ctx.live.detach('room-1')
    ctx.failRooms(new Error('base down'))
    await assert.rejects(ctx.live.attach(ctx.room()), /base down/)
    ctx.failRooms(null)
    const room = ctx.room()
    const [first, second] = await Promise.all([ctx.live.attach(room), ctx.live.attach(room)])
    assert.equal(first, second)
    assert.equal(ctx.live.isAttached('room-1'), true)
  } finally {
    ctx.close()
  }
})

test('an unanswered approval pauses the room, and deciding it resumes the room', async () => {
  const ctx = await setup({ approvalTimeoutMs: 30 })
  try {
    ctx.permission('git push origin main')
    await new Promise(resolve => setTimeout(resolve, 80))
    const paused = ctx.room()
    assert.equal(paused.state, 'paused')
    assert.equal(paused.pauseReason, 'approval')
    assert.deepEqual(roomNeedsYou(paused), {
      kind: 'approval',
      stage: null,
      label: '确认超时',
    })
    const approval = paused.approvals.find(item => item.state === 'pending')
    await ctx.live.decideApproval('room-1', approval.id, 'allow')
    const resumed = ctx.room()
    assert.equal(resumed.state, 'active')
    assert.equal(resumed.pauseReason, null)
    assert.ok(resumed.approvals.some(item => item.id === approval.id && item.state === 'allowed'))
    assert.match(ctx.store.readMessages('room-1').at(-1).text, /房间继续/)
  } finally {
    ctx.close()
  }
})

test('a double click answers the runtime only once', async () => {
  const ctx = await setup()
  try {
    ctx.permission('git push origin main')
    await tick()
    const approval = ctx.room().approvals.find(item => item.state === 'pending')
    const [first, second] = await Promise.all([
      ctx.live.decideApproval('room-1', approval.id, 'allow'),
      ctx.live.decideApproval('room-1', approval.id, 'allow'),
    ])
    assert.equal([first, second].filter(result => result.ok === true).length, 1)
    assert.equal(ctx.answers.filter(answer => answer.behavior === 'allow').length, 1)
  } finally {
    ctx.close()
  }
})

test('a pending card keeps its timer while another card has paused the room', async () => {
  const ctx = await setup({ approvalTimeoutMs: 30 })
  try {
    ctx.permission('git push origin main')
    ctx.permission('git push origin next')
    await tick()
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(ctx.room().state, 'paused')
    const [first, second] = ctx.room().approvals.filter(item => item.state === 'pending')
    await ctx.live.decideApproval('room-1', first.id, 'allow')
    await new Promise(resolve => setTimeout(resolve, 80))
    const paused = ctx.room()
    assert.equal(paused.state, 'paused')
    assert.equal(paused.approvals.find(item => item.id === second.id).state, 'pending')
  } finally {
    ctx.close()
  }
})

test('reopening a room paused by an expired approval resumes it', async () => {
  const ctx = await setup({ approvalTimeoutMs: 30 })
  try {
    ctx.permission('git push origin main')
    await new Promise(resolve => setTimeout(resolve, 80))
    assert.equal(ctx.room().state, 'paused')
    const reopened = createLiveRooms({
      store: ctx.store,
      engine: ctx.engine,
      emit: () => {},
          ports: createCrewPorts(),
    })
    await reopened.attach(ctx.room())
    const room = ctx.room()
    assert.equal(room.state, 'active')
    assert.equal(room.pauseReason, null)
    assert.ok(room.approvals.every(item => item.state !== 'pending'))
  } finally {
    ctx.close()
  }
})

test('an external command is held for the human instead of being auto-allowed', async () => {
  const ctx = await setup()
  try {
    ctx.permission('git push origin main')
    await tick()
    const room = ctx.room()
    assert.equal(ctx.answers.length, 0)
    assert.equal(room.approvals.length, 1)
    const approval = room.approvals[0]
    assert.equal(approval.state, 'pending')
    assert.equal(approval.kind, 'push')
    assert.equal(approval.gate.decision, 'review')
    assert.equal(approval.gate.context, 'independent')
    assert.equal(roomNeedsYou(room).kind, 'approval')
    const message = ctx.store.readMessages('room-1').at(-1)
    assert.equal(message.meta.approvalId, approval.id)

    await ctx.live.decideApproval('room-1', approval.id, 'allow')
    assert.deepEqual(ctx.answers, [{
      sessionRef: 'thread-1',
      requestId: approval.requestId,
      behavior: 'allow',
    }])
    assert.equal(ctx.room().approvals[0].state, 'allowed')
    assert.match(ctx.store.readMessages('room-1').at(-1).text, /可以做/)
  } finally {
    ctx.close()
  }
})

test('a denial answers the base card with deny and leaves the approval denied', async () => {
  const ctx = await setup()
  try {
    ctx.permission('rm -rf build')
    await tick()
    const approval = ctx.room().approvals[0]
    await ctx.live.decideApproval('room-1', approval.id, 'deny')
    assert.equal(ctx.answers[0].behavior, 'deny')
    assert.equal(ctx.room().approvals[0].state, 'denied')
  } finally {
    ctx.close()
  }
})

test('an internal command still follows the member permission without an approval', async () => {
  const ctx = await setup()
  try {
    ctx.permission('npm test')
    await tick()
    assert.equal(ctx.room().approvals, undefined)
    assert.equal(ctx.answers[0].behavior, 'allow')
  } finally {
    ctx.close()
  }
})

test('stopping a room expires approvals that can no longer be answered', async () => {
  const ctx = await setup()
  try {
    ctx.permission('npm install left-pad')
    await tick()
    const expiry = await ctx.live.expireApprovals('room-1', '房间已停止')
    assert.equal(expiry.approvals[0].state, 'expired')
    assert.equal(ctx.room().approvals[0].state, 'expired')
    const late = await ctx.live.decideApproval('room-1', ctx.room().approvals[0].id, 'allow')
    assert.equal(late.ok, false)
    assert.match(late.reason, /没有待确认/)
  } finally {
    ctx.close()
  }
})

test('a permission denial answers the base and is not replayed', async () => {
  const ctx = await setup({ permissions: { read: true, exec: false, write: false } })
  try {
    ctx.permission('forbidden.txt', { requestId: 'req-deny', tool: 'Write', action: 'write' })
    await tick()
    assert.equal(ctx.answers[0].behavior, 'deny')
    assert.ok(ctx.store.readMessages('room-1').some(message => /权限拒绝/.test(message.text ?? '')))
    assert.equal(ctx.store.readMessages('room-1').some(message => /权限卡处理失败/.test(message.text ?? '')), false)
    ctx.permission('forbidden.txt', { requestId: 'req-deny', tool: 'Write', action: 'write' })
    await tick()
    assert.equal(ctx.answers.length, 1)
  } finally {
    ctx.close()
  }
})

test('a direct-workspace verifier loses exec', async () => {
  const ctx = await setup({
    provider: 'direct',
    role: 'verifier',
    roleKind: 'verifier',
    permissions: { read: true, exec: true, write: false },
  })
  try {
    ctx.permission('npm test', { requestId: 'req-direct', tool: 'Bash', action: 'exec' })
    await tick()
    assert.equal(ctx.answers[0].behavior, 'deny')
    assert.ok(ctx.store.readMessages('room-1').some(message => /原地目录的验收员只能读/.test(message.text ?? '')))
  } finally {
    ctx.close()
  }
})

test('a detached room denies its pending card instead of leaving the base waiting', async () => {
  const ctx = await setup()
  try {
    ctx.permission('git push origin main')
    await tick()
    const approval = ctx.room().approvals.find(item => item.state === 'pending')
    ctx.live.detach('room-1')
    await tick()
    assert.ok(ctx.answers.some(answer => answer.requestId === approval.requestId && answer.behavior === 'deny'))
    assert.equal(ctx.room().approvals.find(item => item.id === approval.id).state, 'expired')
  } finally {
    ctx.close()
  }
})

test('pending approvals are never dropped by the history cap', async () => {
  const ctx = await setup()
  try {
    for (let index = 0; index < 21; index += 1) ctx.permission(`git push origin branch-${index}`)
    await tick()
    const pending = ctx.room().approvals.filter(item => item.state === 'pending')
    assert.equal(pending.length, 21)
    assert.equal(ctx.room().approvals.length, 21)
  } finally {
    ctx.close()
  }
})


test('answering a card from an earlier stage is refused without touching the base', async () => {
  const ctx = await setup()
  try {
    ctx.store.appendMessage('room-1', {
      kind: 'question',
      authorId: 'worker',
      text: '选哪个方案？',
      meta: {
        card: {
          requestId: 'req-old',
          requestType: 'question',
          scope: { stage: 1, floor: -1 },
        },
      },
    })
    const result = await ctx.live.answerCard('room-1', 'worker', 'req-old', '选 B')
    assert.equal(result.ok, false)
    assert.match(result.reason, /过期/)
    assert.equal(ctx.answers.length, 0)
  } finally {
    ctx.close()
  }
})

test('a pending approval from an earlier stage expires instead of being decided', async () => {
  const ctx = await setup()
  try {
    ctx.permission('git push origin main')
    await tick()
    const approval = ctx.room().approvals.find(item => item.state === 'pending')
    ctx.store.updateRoom('room-1', current => {
      current.stages[0].state = 'passed'
      current.stages.push({ title: '下一步', kind: 'deliverable', state: 'active', acceptance: 'npm test' })
      return { events: [] }
    })
    const result = await ctx.live.decideApproval('room-1', approval.id, 'allow')
    assert.equal(result.ok, false)
    assert.match(result.reason, /过期/)
    assert.equal(ctx.room().approvals.find(item => item.id === approval.id).state, 'expired')
    assert.ok(ctx.answers.some(answer => answer.behavior === 'deny'))
  } finally {
    ctx.close()
  }
})

test('a lost base marks the room and a later start clears it', async () => {
  const ctx = await setup({ retryMs: 10, startAttempts: 0 })
  try {
    ctx.failRooms(new Error('base down'))
    await ctx.live.start()
    await new Promise(resolve => setTimeout(resolve, 20))
    assert.match(ctx.room().connectionError ?? '', /base down/)
    ctx.failRooms(null)
    await new Promise(resolve => setTimeout(resolve, 40))
    assert.equal(ctx.room().connectionError, undefined)
  } finally {
    ctx.close()
  }
})
