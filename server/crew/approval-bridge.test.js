import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { roomNeedsYou } from './attention.js'
import { createLiveRooms } from './live.js'
import { createStore } from './store.js'

const tick = () => new Promise(resolve => setTimeout(resolve, 20))

const setup = async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-approval-'))
  const store = createStore({ dataDir: join(dir, 'db') })
  const room = {
    id: 'room-1',
    kind: 'room',
    name: '审批房间',
    goal: '验证外部动作审批',
    state: 'active',
    live: true,
    imported: false,
    repoPath: dir,
    sourceRepo: dir,
    stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
    seatRooms: { worker: { id: 'base-1' } },
    seatSpecs: [{
      id: 'worker',
      name: '执行',
      role: 'worker',
      permissions: { read: true, exec: true, write: true },
    }],
    members: ['worker'],
    seatNames: { worker: '执行' },
    verifiers: [],
    usage: { turns: 0, costMicroUsd: 0 },
  }
  store.writeRoom(room)
  const answers = []
  let onEvent = null
  const engine = {
    rooms: async () => [{
      id: 'base-1',
      name: '执行',
      sessionRef: 'thread-1',
      working: false,
      usage: { turns: 0, costMicroUsd: 0, tokens: {} },
    }],
    history: async () => ({ messages: [] }),
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
    dispatchPayload: () => ({}),
  })
  await live.attach(store.readRoom('room-1'))
  return {
    dir,
    store,
    live,
    answers,
    room: () => store.readRoom('room-1'),
    permission: subtitle => {
      onEvent({
        type: 'message',
        message: {
          id: `msg-${Math.random()}`,
          card: {
            requestType: 'permission',
            requestId: `req-${Math.random()}`,
            tool: 'Bash',
            action: 'exec',
            subtitle,
            options: [],
          },
        },
      })
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}

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
    assert.match(ctx.store.readMessages('room-1').at(-1).text, /已允许/)
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

test('an internal command still follows the seat permission without an approval', async () => {
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
    const expiry = ctx.live.expireApprovals('room-1', '房间已停止')
    assert.equal(expiry.approvals[0].state, 'expired')
    assert.equal(ctx.room().approvals[0].state, 'expired')
    const late = await ctx.live.decideApproval('room-1', ctx.room().approvals[0].id, 'allow')
    assert.equal(late.ok, false)
    assert.match(late.reason, /没有待批准/)
  } finally {
    ctx.close()
  }
})
