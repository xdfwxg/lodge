import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlanApplier } from './apply-plan.js'

const setup = (instances = [
  { id: 'claude', engine: 'claude', name: 'Claude', available: true, models: { default: 'x', options: ['x', 'x2'] }, capabilities: { approvalReview: true, tools: true } },
  { id: 'pi', engine: 'pi', name: 'Pi', available: true, models: { default: 'y', options: ['y'] }, capabilities: { approvalReview: true, tools: true } },
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
    updateRoom: (_roomId, mutate) => {
      const result = mutate(room)
      return result === null ? null : room
    },
    updateRound: (_roomId, mutate) => {
      mutate(room.workRound)
      room.stages = room.workRound.stages ?? room.stages
      return room
    },
    appendMessage: (_roomId, message) => { messages.push(message); return message },
    readMessages: () => messages,
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
    contract: {
      version: 1,
      outcomes: [{ id: 'out', statement: '导出按钮能用', observable: '点导出会下载 CSV' }],
    },
    plan: {
      done: ['能跑'],
      stages: [{ title: '实现', deliverable: '导出按钮能用', clauseIds: ['out'], packages: [{ title: '导出', files: ['src/export.js'], clauseIds: ['out'] }] }],
    },
    crew: {
      executors: [{ engine: 'claude', model: 'x', name: '执行官甲' }],
      verifiers: [{ engine: 'pi', model: 'y', name: '验收员' }],
    },
    ...over,
  },
})

test('a package that omits a file named in the goal is refused before anyone is opened', async () => {
  const ctx = setup()
  ctx.room.goal = '在仓库根目录新建 hello.txt；再写 tools/check.mjs；不要改 package.json。'
  await ctx.applier('room-1', proposal())
  // 包漏了目标点名要写的文件：包就是写边界，先退回去补，别等执行官写完被边界退回。
  // 第一次退回是发给规划师的一句话，不是群里的系统消息。
  const told = ctx.sent.find(item => /没有落进任何工作包/.test(item.text ?? ''))
  assert.ok(told)
  assert.match(told.text, /hello\.txt/)
  assert.match(told.text, /tools\/check\.mjs/)
  assert.deepEqual(ctx.room.members.map(member => member.role), ['lead'])
  assert.deepEqual(ctx.started, [])
})

test('a plan that covers every file named in the goal opens the crew', async () => {
  const ctx = setup()
  ctx.room.goal = '新建 hello.txt；写 tools/check.mjs；交付 lodge-proof.json。'
  const files = ['hello.txt', 'tools/check.mjs', 'lodge-proof.json']
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['能跑'],
      stages: [{
        title: '实现',
        deliverable: '三个文件齐备',
        clauseIds: ['out'],
        packages: [{ title: '全部', files, clauseIds: ['out'] }],
      }],
    },
  }))
  assert.equal(ctx.room.members.filter(member => member.role === 'worker').length, 1)
  assert.deepEqual(ctx.started, [1])
})

test('a valid plan opens the crew and starts the first work stage', async () => {
  const ctx = setup()
  await ctx.applier('room-1', proposal())
  assert.deepEqual(ctx.room.members.map(member => member.role).sort(), ['lead', 'verifier', 'worker'])
  assert.equal(ctx.room.workRound.plan.stages.length, 1)
  assert.deepEqual(ctx.room.workRound.plan.stages[0].packages[0].clauseIds, ['out'])
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
        clauseIds: ['out'],
        packages: [{ title: '设定与大纲', files: ['OUTLINE.md'], clauseIds: ['out'] }],
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
        deliverable: '两块都完成',
        clauseIds: ['out'],
        packages: [{ title: '甲', files: ['a.js'], clauseIds: ['out'] }, { title: '乙', files: ['b.js'], clauseIds: ['out'] }],
      }],
    },
  }))
  assert.equal(ctx.room.members.length, 1)
  assert.match(ctx.sent.at(-1).text, /需要 2 位执行官/)
  assert.deepEqual(ctx.started, [])
})

test('a machine with one model may still deliver, marked as self-review', async () => {
  const ctx = setup([
    { id: 'claude', engine: 'claude', available: true, name: 'Claude', models: { default: 'x', options: ['x'] }, capabilities: { approvalReview: true, tools: true } },
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
    { id: 'claude', engine: 'claude', available: true, name: 'Claude', models: { default: 'x', options: ['x', 'x2'] }, capabilities: { approvalReview: true, tools: true } },
    { id: 'pi', engine: 'pi', available: true, name: 'Pi', models: { default: 'y', options: ['y'] }, capabilities: { approvalReview: true, tools: true } },
    { id: 'kimi', engine: 'kimi', available: true, name: 'Kimi', models: { default: 'z', options: ['z'] }, capabilities: { approvalReview: true, tools: true } },
  ])
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['两块都完成'],
      stages: [{
        title: '实现',
        deliverable: '两块都完成',
        clauseIds: ['out'],
        packages: [
          { title: '导出', files: ['src/export.js'], clauseIds: ['out'] },
          { title: '导入', files: ['src/import.js'], clauseIds: ['out'] },
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
      stages: [{ title: '升级依赖', deliverable: '锁文件已更新', clauseIds: ['out'], packages: [{ title: '升级', files: ['package.json'], clauseIds: ['out'] }] }],
    },
  }))
  assert.deepEqual(single.started, [])
  assert.match(single.sent.at(-1).text, /高风险默认开两位验收员/)

  const sameVendor = setup([
    { id: 'claude', engine: 'claude', available: true, name: 'Claude', models: { default: 'x', options: ['x', 'x2'] }, capabilities: { approvalReview: true, tools: true } },
    { id: 'pi', engine: 'pi', available: true, name: 'Pi', models: { default: 'y', options: ['y'] }, capabilities: { approvalReview: true, tools: true } },
  ])
  await sameVendor.applier('room-1', proposal({
    plan: {
      done: ['依赖更新'],
      stages: [{ title: '升级依赖', deliverable: '锁文件已更新', clauseIds: ['out'], packages: [{ title: '升级', files: ['package.json'], clauseIds: ['out'] }] }],
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
    { id: 'claude', engine: 'claude', available: true, name: 'Claude', models: { default: 'x', options: ['x'] }, capabilities: { approvalReview: true, tools: true } },
  ])
  await ctx.applier('room-1', proposal({
    plan: {
      done: ['依赖更新'],
      stages: [{ title: '升级依赖', deliverable: '锁文件已更新', clauseIds: ['out'], packages: [{ title: '升级', files: ['package.json'], clauseIds: ['out'] }] }],
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
  assert.equal(ctx.room.workRound.openQuestion, undefined, '前两次只是教它改，不拦人')
  await ctx.applier('room-1', { error: '方案的格式不对' })
  assert.equal(ctx.room.workRound.planRejections, 3)
  // 三次都不过就停在等人：必须有一张看得见、回得了的问题卡，而不是一句没人接得住的系统话。
  // openQuestion 是轮次字段：写进 workRound，再由房间投影读出来。
  assert.equal(ctx.room.workRound.openQuestion, '方案还没通过：告诉规划师怎么改。')
})

test('an unknown engine is refused with the engines this machine actually has', async () => {
  // 真房教训：只说“找不到引擎 deepseek”，规划师下一版还会犯同一个错，最后房间停在等人。
  const ctx = setup()
  await ctx.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'deepseek', model: 'deepseek-flash', name: '执行官甲' }],
      verifiers: [{ engine: 'pi', model: 'y', name: '验收员' }],
    },
  }))
  assert.equal(ctx.room.members.length, 1)
  assert.deepEqual(ctx.started, [])
  const told = ctx.sent.at(-1).text
  assert.match(told, /找不到引擎 deepseek/)
  assert.match(told, /pi（默认模型 y）/)
  assert.match(told, /claude（默认模型 x）/)
  assert.match(told, /engine 只填引擎名/)
})

test('a model given as { id, label } is accepted, and a wrong name is replaced by the engine default', async () => {
  // 真房教训：可选模型是对象时，旧的 includes(member.model) 连合法 id 都判错，
  // 退回消息还把对象拼成 [object Object]。模型名是机器配置，不该让规划猜。
  const ctx = setup([
    { id: 'pi', engine: 'pi', available: true, name: 'Pi', models: { default: 'deepseek/deepseek-flash', options: [{ id: 'deepseek/deepseek-flash', label: 'Flash' }, { id: 'deepseek/deepseek-pro', label: 'Pro' }] }, capabilities: { approvalReview: true, tools: true } },
  ])
  await ctx.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'pi', model: 'deepseek/deepseek-pro', name: '执行官甲' }],
      verifiers: [{ engine: 'pi', model: 'deepseek/deepseek-pro', name: '验收员' }],
    },
  }))
  assert.equal(ctx.room.members.length, 3, '对象形式的可选模型要认 id')

  const second = setup([
    { id: 'pi', engine: 'pi', available: true, name: 'Pi', models: { default: 'deepseek/deepseek-flash', options: [{ id: 'deepseek/deepseek-flash', label: 'Flash' }] }, capabilities: { approvalReview: true, tools: true } },
  ])
  await second.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'pi', model: 'pi/claude-sonnet-4-5', name: '执行官甲' }],
      verifiers: [{ engine: 'pi', model: 'deepseek/deepseek-flash', name: '验收员' }],
    },
  }))
  assert.equal(second.room.members.length, 3, '写错模型不该退一轮')
  assert.match(second.messages.map(message => message.text ?? '').join('\n'), /按这台机器补上了/)
})

test('on a single-engine machine a made-up engine name becomes that engine', async () => {
  // 真房教训：规划师写 google/gemini、OpenAI 这类这台机器没有的名字，退回三次后房间只能停下。
  // 只有一台引擎时没有选择，直接改对并说清楚。
  const ctx = setup([
    { id: 'pi', engine: 'pi', name: 'Pi', available: true, models: { default: 'deepseek/deepseek-flash', options: [{ id: 'deepseek/deepseek-flash' }] }, capabilities: { approvalReview: true, tools: true } },
  ])
  await ctx.applier('room-1', proposal({
    crew: {
      executors: [{ engine: 'openai', model: 'gpt-5', name: '执行官甲' }],
      verifiers: [{ engine: 'google', model: 'gemini-2.5-pro', name: '验收员' }],
    },
  }))
  assert.equal(ctx.room.members.length, 3)
  assert.match(ctx.messages.map(message => message.text ?? '').join('\n'), /按这台机器补上了/)
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


test('a second plan in the same round is refused out loud, not dropped', async () => {
  const ctx = setup()
  // 这一轮已经有方案：再提交一版不该沉默。
  ctx.room.workRound.plan = { stages: [{ title: '已有方案' }] }
  await ctx.applier('room-1', { proposal: {} })
  assert.equal(ctx.messages.filter(message => String(message.text ?? '').includes('这一轮的方案已经定过')).length, 1)
  assert.equal(ctx.sent.length, 1)
  // 同一轮不重复刷屏。
  await ctx.applier('room-1', { proposal: {} })
  assert.equal(ctx.messages.filter(message => String(message.text ?? '').includes('这一轮的方案已经定过')).length, 1)
  assert.equal(ctx.sent.length, 1)
})
