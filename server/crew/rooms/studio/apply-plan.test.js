import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlanApplier } from './apply-plan.js'

const setup = (instances = [
  { id: 'claude', engine: 'claude', name: 'Claude', models: { default: 'x', options: ['x', 'x2'] } },
  { id: 'pi', engine: 'pi', name: 'Pi', models: { default: 'y', options: ['y'] } },
], options = {}) => {
  const room = {
    id: 'room-1',
    roomType: 'studio',
    goal: '把导出按钮做出来',
    name: '导出',
    state: 'active',
    leadMemberId: 'planner',
    members: [{ id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', body: { engine: 'claude', model: 'x' } }],
    stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: 'active' }],
    workRound: { id: 'round-1', status: 'active', plan: null },
    workspace: { provider: 'git' },
    worktrees: {},
    branches: {},
  }
  const messages = []
  const started = []
  const sent = []
  const store = {
    readRoom: () => room,
    updateRound: (_roomId, mutate) => {
      mutate(room.workRound)
      room.stages = room.workRound.stages ?? room.stages
      return room
    },
    appendMessage: (_roomId, message) => { messages.push(message); return message },
    appendEvent: () => {},
  }
  let count = 0
  const memberAdd = {
    add: async (current, body) => {
      const id = `${body.role}-${(count += 1)}`
      current.members.push({
        id,
        name: body.name === '' ? id : body.name,
        role: body.role,
        roleKind: body.role === 'worker' ? 'executor' : 'verifier',
        body: { engine: body.engine, model: body.model },
      })
      return { ok: true, body: { memberId: id } }
    },
  }
  const memberRemove = {
    remove: async (current, body) => {
      current.members = current.members.filter(member => member.id !== body.memberId)
      return { ok: true }
    },
  }
  const engine = { instances: async () => instances }
  const live = { startStage: async (_room, index) => { started.push(index) } }
  const applier = createPlanApplier({
    store,
    engine,
    live,
    emit: () => {},
    memberAdd,
    memberRemove,
    verifierPool: options.verifierPool ?? null,
    sendToMember: async (roomId, memberId, text) => { sent.push({ roomId, memberId, text }) },
  })
  return { room, store, messages, started, sent, applier }
}

const proposal = (over = {}) => ({
  proposal: {
    plan: {
      done: ['能跑'],
      stages: [{ title: '实现', deliverable: '导出按钮能用', packages: [{ title: '导出', files: ['src/export.js'] }] }],
    },
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [{ engine: 'pi', model: 'y', name: '验收员' }],
    },
    ...over,
  },
})

test('a valid plan opens the crew and starts the first work stage', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal())
  assert.deepEqual(ctx.room.members.map(member => member.role).sort(), ['lead', 'verifier', 'worker'])
  assert.equal(ctx.room.workRound.plan.stages.length, 1)
  assert.equal(ctx.room.stages[0].state, 'passed')
  assert.equal(ctx.room.stages[1].state, 'active')
  assert.deepEqual(ctx.started, [1])
  assert.match(ctx.messages.at(-1).text, /队伍已经开好/)
  assert.deepEqual(ctx.sent, [])
})

test('a writing stage is applied with its deliverable, not a check', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['设定自洽'],
      stages: [{
        title: '世界与骨架',
        deliverable: '设定、境界和六卷大纲',
        packages: [{ title: '设定与大纲', files: ['OUTLINE.md'] }],
      }],
    },
  }))
  assert.equal(ctx.room.workRound.plan.stages.length, 1)
  assert.equal(ctx.room.workRound.plan.stages[0].deliverable, '设定、境界和六卷大纲')
  assert.equal(ctx.room.stages[1].state, 'active')
  assert.deepEqual(ctx.started, [1])
  assert.deepEqual(ctx.sent, [])
})

test('the planner can open more than one verifier', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [
        { engine: 'pi', model: 'y', name: '验收员甲' },
        { engine: 'pi', model: 'y', name: '验收员乙' },
      ],
    },
  }))
  assert.equal(ctx.room.members.filter(member => member.role === 'verifier').length, 2)
  assert.equal(ctx.room.members.length, 4)
  assert.deepEqual(ctx.started, [1])
})

test('the same vendor for the verifier is refused before opening anyone', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [{ engine: 'claude', model: 'x2', name: '验收员' }],
    },
  }))
  assert.equal(ctx.room.members.length, 1)
  assert.match(ctx.sent.at(-1).text, /不同厂商/)
  assert.deepEqual(ctx.started, [])
})

test('two independent packages need two executors', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['能跑'],
      stages: [{
        title: '实现',
        packages: [{ title: '甲', files: ['a.js'] }, { title: '乙', files: ['b.js'] }],
      }],
    },
  }))
  assert.equal(ctx.room.members.length, 1)
  assert.match(ctx.sent.at(-1).text, /需要 2 位执行官/)
  assert.deepEqual(ctx.started, [])
})

test('a machine with one model may still deliver, marked as self-review', async () => {
  const ctx = setup([
    { id: 'claude', engine: 'claude', name: 'Claude', models: { default: 'x', options: ['x'] } },
  ])
  await ctx.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [{ engine: 'claude', model: 'x', name: '验收员' }],
    },
  }))
  assert.equal(ctx.room.members.length, 3)
  assert.ok(ctx.messages.some(message => /模型自查/.test(message.text ?? '')))
  assert.deepEqual(ctx.started, [1])
})

test('the same plan is not applied twice', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal())
  const before = ctx.room.members.length
  await ctx.applier('room-1', proposal())
  assert.equal(ctx.room.members.length, before)
  assert.deepEqual(ctx.started, [1])
})

test('a parallel plan writes orchestration through the round instead of the room', async () => {
  const ctx = setup([
    { id: 'claude', engine: 'claude', name: 'Claude', models: { default: 'x', options: ['x', 'x2'] } },
    { id: 'pi', engine: 'pi', name: 'Pi', models: { default: 'y', options: ['y'] } },
    { id: 'kimi', engine: 'kimi', name: 'Kimi', models: { default: 'z', options: ['z'] } },
  ])
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['两块都完成'],
      stages: [{
        title: '实现',
        packages: [
          { title: '导出', files: ['src/export.js'] },
          { title: '导入', files: ['src/import.js'] },
        ],
      }],
    },
    crew: {
      executors: [
        { engine: 'claude', model: 'x', name: '执行官甲' },
        { engine: 'claude', model: 'x2', name: '执行官乙' },
      ],
      verifiers: [
        { engine: 'pi', model: 'y', name: '验收员甲' },
        { engine: 'kimi', model: 'z', name: '验收员乙' },
      ],
    },
  }))
  assert.equal(ctx.room.workRound.orchestration, 'parallel')
  assert.deepEqual(ctx.started, [1])
})

test('a high-risk stage needs two verifiers from different vendors', async () => {
  const single = setup()
  await single.applier('room-1', proposal({
    plan: {
      done: ['依赖更新'],
      stages: [{ title: '升级依赖', deliverable: '锁文件已更新', packages: [{ title: '升级', files: ['package.json'] }] }],
    },
  }))
  assert.deepEqual(single.started, [])
  assert.match(single.sent.at(-1).text, /高风险默认开两位验收员/)

  const sameVendor = setup([
    { id: 'claude', engine: 'claude', name: 'Claude', models: { default: 'x', options: ['x', 'x2'] } },
    { id: 'pi', engine: 'pi', name: 'Pi', models: { default: 'y', options: ['y'] } },
  ])
  await sameVendor.applier('room-1', proposal({
    plan: {
      done: ['依赖更新'],
      stages: [{ title: '升级依赖', deliverable: '锁文件已更新', packages: [{ title: '升级', files: ['package.json'] }] }],
    },
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [
        { engine: 'pi', model: 'y', name: '验收员甲' },
        { engine: 'pi', model: 'y', name: '验收员乙' },
      ],
    },
  }))
  assert.deepEqual(sameVendor.started, [])
  assert.match(sameVendor.sent.at(-1).text, /不同厂商/)
})

test('a high-risk stage on a single-vendor machine is labelled self-review', async () => {
  const ctx = setup([
    { id: 'claude', engine: 'claude', name: 'Claude', models: { default: 'x', options: ['x'] } },
  ])
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['依赖更新'],
      stages: [{ title: '升级依赖', deliverable: '锁文件已更新', packages: [{ title: '升级', files: ['package.json'] }] }],
    },
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [{ engine: 'claude', model: 'x', name: '验收员' }],
    },
  }))
  assert.equal(ctx.room.stages[1].state, 'active')
  assert.ok(ctx.messages.some(message => /高风险.*只有一家模型/.test(message.text ?? '')))
})

test('a verifier model kept out of the probe pool cannot open the crew', async () => {
  const ctx = setup(undefined, {
    verifierPool: {
      version: 1,
      models: { 'pi:y': { status: 'excluded', defectSamples: 10, falsePassRate: 0.2 } },
    },
  })
  await ctx.applier('room-1', proposal())
  assert.equal(ctx.room.members.length, 1)
  assert.deepEqual(ctx.started, [])
  assert.match(ctx.sent.at(-1).text, /误放率/)
})

test('rejected plans count toward the retry limit on the round', async () => {
  const ctx = setup()
  await ctx.applier('room-1', { error: '方案的格式不对' })
  await ctx.applier('room-1', { error: '方案的格式不对' })
  assert.equal(ctx.room.workRound.planRejections, 2)
})

test('two concurrent plan submissions open the crew once', async () => {
  const ctx = setup()
  await Promise.all([
    ctx.applier('room-1', proposal()),
    ctx.applier('room-1', proposal()),
  ])
  assert.equal(ctx.room.members.length, 3)
  assert.deepEqual(ctx.started, [1])
})
