import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createRealRoom } from './rooms/create/create.js'
import { createStore } from './store.js'

const temp = prefix => mkdtempSync(join(tmpdir(), prefix))

const gitRepo = () => {
  const repo = temp('lodge-resume-repo-')
  execFileSync('git', ['init', '-q'], { cwd: repo })
  writeFileSync(join(repo, 'README.md'), '# demo\n')
  execFileSync('git', ['add', 'README.md'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Lodge', '-c', 'user.email=lodge@localhost', 'commit', '-q', '-m', 'init'], { cwd: repo })
  return repo
}

const completedRoom = dataDir => {
  const store = createStore({ dataDir })
  const archive = join(dataDir, 'rooms', 'room-complete-test')
  const room = {
    id: 'room-complete-test',
    kind: 'room',
    name: '上一轮交付',
    goal: '加一个导出按钮',
    state: 'complete',
    stages: [{ title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' }],
    constraints: [],
    seatSpecs: [],
    workers: ['executor'],
    verifiers: [],
    repoPath: archive,
    demo: false,
    live: false,
    usage: {},
    version: 1,
  }
  store.writeRoom(room)
  store.appendMessage(room.id, { kind: 'system', text: '上一轮完成' })
  return { store, room }
}

const fakeEngine = () => {
  const seatNames = []
  const skillAssignments = []
  return {
    seatNames,
    skillAssignments,
    capabilities: () => ({ provisioning: true, mentions: true, mcp: false }),
    createMemberBot: async ({ name }) => {
      seatNames.push(name)
      return { id: `member-${name}`, name, engine: 'claude', model: 'claude-sonnet-5' }
    },
    setBotSkills: async (botId, skills) => {
      skillAssignments.push({ botId, skills })
      return { assignedSkills: skills }
    },
    createRoom: async ({ name }) => ({ id: `room-${name}`, sessionRef: `thread-${name}` }),
  }
}

const fakeLive = () => ({
  attach: async () => {},
  startStage: async () => {},
  sendToMember: async () => ({ messageId: null }),
})

const run = (store, body, engine = fakeEngine(), workspace = null, parentRoom = null) => createRealRoom({
  store,
  engine,
  live: fakeLive(),
  emit: () => {},
  body,
  workspace,
  ports: createCrewPorts(),
  parentRoom,
})

test('creation fails closed when the runtime cannot wake members with @', async () => {
  const store = createStore({ dataDir: temp('lodge-mentions-data-') })
  const engine = fakeEngine()
  engine.capabilities = () => ({ provisioning: true, mentions: false, mcp: false })
  const result = await run(store, {
    goal: '验证 mentions 门禁',
    verify: 'manual',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }, engine)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /@ 唤醒/)
})

test('a subroom records its parent and links back to it', async () => {
  const { store } = completedRoom(temp('lodge-subroom-data-'))
  const parent = {
    id: 'room-parent',
    kind: 'room',
    name: '父工作室',
    goal: '父目标',
    roomType: 'studio',
    state: 'active',
    depth: 0,
    childRoomIds: [],
    seatSpecs: [],
    members: [],
    leadSeat: 'lead',
    seatNames: {},
    stages: [],
    constraints: [],
    version: 1,
    live: true,
    demo: false,
    usage: {},
  }
  store.writeRoom(parent)
  const result = await run(store, {
    goal: '子部门目标',
    roomType: 'studio',
    verify: 'manual',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }, fakeEngine(), null, parent)
  assert.equal(result.ok, true)
  const child = result.body.room
  assert.equal(child.parentRoomId, 'room-parent')
  assert.equal(child.depth, 1)
  assert.deepEqual(store.readRoom('room-parent').childRoomIds, [child.id])
  assert.deepEqual(store.readAssignments('room-parent'), [])
})

test('a custom room name is kept while the stage title follows the goal', async () => {
  const { store } = completedRoom(temp('lodge-name-data-'))
  const engine = fakeEngine()
  const result = await run(store, {
    goal: '加一个导出按钮',
    name: '导出交付',
    verify: 'manual',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }, engine)
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.name, '导出交付')
  assert.equal(room.goal, '加一个导出按钮')
  assert.equal(room.stages.some(stage => stage.title === '加一个导出按钮'), true)
  // 房间名就是基座成员名；id 才是稳定身份，不再生成 Lead/Worker 这类隐藏名。
  assert.deepEqual(engine.seatNames.sort(), ['执行', '规划', '验收'].sort())
  assert.deepEqual(room.members.map(member => member.name).sort(), ['执行', '规划', '验收'].sort())
})

test('declared member skills are assigned to the created base member', async () => {
  const { store } = completedRoom(temp('lodge-skill-data-'))
  const engine = fakeEngine()
  const result = await run(store, {
    goal: '带一个复核技能',
    verify: 'manual',
    members: [
      { role: 'lead', name: '规划' },
      { role: 'worker', name: '执行', skills: ['evidence-review'] },
      { role: 'verifier', name: '验收' },
    ],
  }, engine)
  assert.equal(result.ok, true)
  assert.deepEqual(engine.skillAssignments, [{
    botId: 'member-执行',
    skills: ['evidence-review'],
  }])
  assert.deepEqual(result.body.room.members.find(member => member.name === '执行').skills, ['evidence-review'])
})

test('member skills fail before creating anything when the base library is off', async () => {
  const { store } = completedRoom(temp('lodge-skill-off-data-'))
  const engine = { ...fakeEngine(), features: async () => ({ skillsLibrary: false }) }
  const result = await run(store, {
    goal: '带一个复核技能',
    verify: 'manual',
    members: [
      { role: 'lead', name: '规划' },
      { role: 'worker', name: '执行', skills: ['evidence-review'] },
      { role: 'verifier', name: '验收' },
    ],
  }, engine)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /技能库/)
  assert.deepEqual(engine.seatNames, [])
})

test('a room name longer than 60 characters is rejected', async () => {
  const { store } = completedRoom(temp('lodge-name-limit-data-'))
  const result = await run(store, {
    goal: '取个长名字',
    name: '房'.repeat(61),
    verify: 'manual',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid')
  assert.match(result.error, /60/)
})

test('a non-git directory is edited in place without a worker copy', async () => {
  const root = temp('lodge-direct-room-')
  const source = join(root, 'docs')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'README.md'), '# docs\n')
  const previousRoot = process.env.CREW_WORKSPACE_ROOT
  const previousCopy = process.env.CREW_COPY_ROOT
  process.env.CREW_WORKSPACE_ROOT = join(root, 'workspace')
  process.env.CREW_COPY_ROOT = join(root, 'copies')
  try {
    const store = createStore({ dataDir: temp('lodge-direct-data-') })
    const result = await run(store, {
      goal: '整理文档',
      verify: 'manual',
      repoPath: source,
      members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    })
    assert.equal(result.ok, true)
    const room = result.body.room
    assert.equal(room.workspace.provider, 'direct')
    assert.equal(room.workspace.capabilities.isolation, 'direct')
    assert.equal(room.workspace.capabilities.vcs, 'none')
    assert.equal(room.workspace.capabilities.commit, false)
    assert.equal(room.repoPath, source)
    const verifier = room.members.find(member => member.role === 'verifier')
    assert.equal(verifier.permissions.exec, false)
    assert.deepEqual(verifier.toolSurface, ['read'])
    assert.equal(existsSync(join(source, '.git')), false)
    assert.equal(existsSync(join(source, 'README.md')), true)
    assert.equal(existsSync(join(root, 'copies')), false)
  } finally {
    if (previousRoot === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previousRoot
    if (previousCopy === undefined) delete process.env.CREW_COPY_ROOT
    else process.env.CREW_COPY_ROOT = previousCopy
    rmSync(root, { recursive: true, force: true })
  }
})

test('an unknown workspace provider fails before creating anything', async () => {
  const { store } = completedRoom(temp('lodge-resume-data-'))
  const result = await run(store, {
    goal: '试试未知 provider',
    verify: 'manual',
    repoPath: gitRepo(),
    workspaceProvider: 'nope',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid')
})

test('a plan with more than three questions is rejected, not silently trimmed', async () => {
  const { store } = completedRoom(temp('lodge-plan-limit-data-'))
  const result = await run(store, {
    goal: '验证开工卡问题上限',
    verify: 'test',
    acceptance: 'true',
    repoPath: gitRepo(),
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    plan: {
      done: ['有一条可核对的 done'],
      answers: [
        { question: 'a', answer: '1' },
        { question: 'b', answer: '2' },
        { question: 'c', answer: '3' },
        { question: 'd', answer: '4' },
      ],
    },
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /最多 3 个问题/)
})

test('a confirmed plan starts at delivery but keeps the final acceptance stage', async () => {
  const { store } = completedRoom(temp('lodge-three-stage-data-'))
  const result = await run(store, {
    goal: '三段式房间',
    verify: 'test',
    acceptance: 'npm test',
    repoPath: gitRepo(),
    members: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    plan: { done: ['验收命令通过'], answers: [{ question: '范围？', answer: '只改一处' }] },
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.deepEqual(room.stages.map(stage => stage.kind), ['decision', 'deliverable', 'decision'])
  assert.equal(room.stages[0].state, 'passed')
  assert.equal(room.stages[1].state, 'active')
  assert.equal(room.stages[2].state, 'pending')
  assert.equal(room.stages[2].title, '验收与结论')
})

test('a plan stage with manual acceptance becomes a decision stage', async () => {
  const { store } = completedRoom(temp('lodge-manual-stage-data-'))
  const result = await run(store, {
    goal: '人工验收阶段',
    verify: 'test',
    acceptance: 'npm test',
    repoPath: gitRepo(),
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    plan: {
      done: ['导出文件'],
      stages: [{ title: '导出', kind: 'deliverable', acceptance: 'manual' }],
    },
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.stages[0].kind, 'decision')
  assert.equal(room.stages[0].acceptance, undefined)
})

test('a plan can declare multiple work stages between alignment and acceptance', async () => {
  const { store } = completedRoom(temp('lodge-plan-stages-data-'))
  const result = await run(store, {
    goal: '多阶段拆解',
    verify: 'test',
    repoPath: gitRepo(),
    members: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    plan: {
      done: ['两段都通过'],
      stages: [
        { title: '实现', kind: 'deliverable', acceptance: 'npm test' },
        { title: '回归', kind: 'deliverable', acceptance: 'npm run e2e' },
      ],
    },
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.deepEqual(room.stages.map(stage => stage.title), ['目标对齐', '实现', '回归', '验收与结论'])
  assert.deepEqual(room.stages.map(stage => stage.state), ['passed', 'active', 'pending', 'pending'])
  assert.equal(room.stages[2].acceptance, 'npm run e2e')
})

test('a redundant opening decision stage is auto-passed', async () => {
  const { store } = completedRoom(temp('lodge-opening-gate-data-'))
  const result = await run(store, {
    goal: '不要重复确认',
    verify: 'test',
    repoPath: gitRepo(),
    members: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    plan: {
      done: ['实现并通过测试'],
      answers: [{ question: '改哪个文件？', answer: 'logo.png' }],
      stages: [
        { title: '确认源文件与改动方向', kind: 'decision' },
        { title: '实现', kind: 'deliverable', acceptance: 'npm test' },
      ],
    },
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.deepEqual(room.stages.map(stage => stage.title), ['目标对齐', '确认源文件与改动方向', '实现', '验收与结论'])
  assert.deepEqual(room.stages.map(stage => stage.state), ['passed', 'passed', 'active', 'pending'])
})

test('legacy room types fail closed', async () => {
  for (const roomType of ['task', 'roundtable', 'archive']) {
    const { store } = completedRoom(temp(`lodge-legacy-${roomType}-data-`))
    const result = await run(store, {
      goal: '旧房型不再接受',
      roomType,
      repoPath: gitRepo(),
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /未知的房间类型/)
  }
})

test('unknown room types fail closed', async () => {
  const { store } = completedRoom(temp('lodge-room-type-data-'))
  const result = await run(store, {
    goal: '未知房型',
    roomType: 'mystery',
    repoPath: gitRepo(),
  })
  assert.equal(result.ok, false)
  assert.match(result.error, /未知的房间类型/)
})

test('a chat room has a configurable turn limit and no trust ladder', async () => {
  const { store } = completedRoom(temp('lodge-chat-rules-data-'))
  const result = await run(store, {
    goal: '圆桌讨论一下交付边界',
    roomType: 'chat',
    chatTurnLimit: 4,
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.chat.turnLimit, 4)
  assert.equal('trust' in room, false)
  assert.equal('stages' in room, false)
})

test('chat speakers can pin their own engine and model', async () => {
  const { store } = completedRoom(temp('lodge-chat-member-model-'))
  const result = await run(store, {
    goal: '聊聊模型选择',
    roomType: 'chat',
    members: [
      { role: 'worker', name: '甲', engine: 'pi', model: 'deepseek/deepseek-flash' },
      { role: 'worker', name: '乙' },
      { role: 'worker', name: '丙' },
    ],
  })
  assert.equal(result.ok, true)
  const members = result.body.room.members
  assert.equal(members[0].engine, 'pi')
  assert.equal(members[0].model, 'deepseek/deepseek-flash')
  assert.equal(members[0].name, '甲')
})

test('an invalid chat turn limit fails before touching the workspace', async () => {
  const { store } = completedRoom(temp('lodge-chat-limit-data-'))
  let prepared = false
  const workspace = {
    id: 'plain',
    capabilities: () => ({ merge: true }),
    prepareRoom: () => { prepared = true; return { members: {} } },
    cleanupRoom: () => {},
  }
  const result = await run(store, {
    goal: '圆桌讨论一下交付边界',
    roomType: 'chat',
    chatTurnLimit: 99,
  }, fakeEngine(), workspace)
  assert.equal(result.ok, false)
  assert.match(result.error, /1–20/)
  assert.equal(prepared, false)
})

test('a single-vendor studio records the downgrade', async () => {
  const { store } = completedRoom(temp('lodge-independence-prefer-'))
  const engine = fakeEngine()
  engine.capabilities = () => ({ provisioning: true, mentions: true, mcp: false })
  engine.instances = async () => [{ id: 'claude', engine: 'claude', available: true }]
  const result = await run(store, {
    goal: '默认允许同厂商但标注降级',
    roomType: 'studio',
    verify: 'manual',
    members: [
      { role: 'lead', name: '规划' },
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '验收' },
    ],
  }, engine)
  assert.equal(result.ok, true)
  assert.equal(result.body.room.independence, 'none')
})

test('studio creation waits for human review when the handoff has disagreements', async () => {
  const store = createStore({ dataDir: temp('lodge-handoff-gate-data-') })
  const handoff = {
    topic: '发布前检查',
    consensus: ['先做最小版本'],
    disagreements: ['是否自动回滚'],
    constraints: ['单文件'],
    todos: ['写初稿'],
  }
  const body = {
    goal: '发布前检查',
    verify: 'manual',
    handoff,
    sourceRoomId: 'room-chat-source',
    sourceName: '圆桌',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }
  const rejected = await run(store, body)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason, 'invalid')
  assert.match(rejected.error, /需要你确认/)

  const accepted = await run(store, { ...body, handoffReviewed: true })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.body.room.gate.humanReviewed, true)
  assert.ok(accepted.body.room.gate.reviewedAt > 0)
  assert.deepEqual(accepted.body.room.gate.verification, { mode: 'manual' })
  assert.equal(accepted.body.room.handoff.disagreements[0], '是否自动回滚')
  assert.equal(accepted.body.room.transfer.kind, 'handoff')
  assert.equal(accepted.body.room.transfer.fromRoomId, 'room-chat-source')
  assert.equal(accepted.body.room.transfer.fromRoomName, '圆桌')
})

test('a long handoff topic becomes a short delivery step', async () => {
  const store = createStore({ dataDir: temp('lodge-handoff-stage-data-') })
  const handoff = {
    topic: '把欢迎语写进 WELCOME.md，并保证任何新成员第一次进来就能看见',
    consensus: ['单句中文'],
    disagreements: [],
    constraints: ['不超过 20 字'],
    todos: ['定稿'],
  }
  const result = await run(store, {
    goal: handoff.topic,
    verify: 'manual',
    handoff,
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.body.room.stages.map(stage => stage.title), [
    '写入 WELCOME.md',
    '验收与结论',
  ])
})

test('a handoff reaches the member bulletin and the opening prompt', async () => {
  const store = createStore({ dataDir: temp('lodge-handoff-bulletin-data-') })
  const bulletins = []
  const engine = fakeEngine()
  const createRoom = engine.createRoom
  engine.createRoom = async args => {
    bulletins.push(args.bulletin ?? '')
    return createRoom(args)
  }
  const handoff = {
    topic: '发布检查',
    consensus: ['先做最小版本'],
    disagreements: [],
    constraints: ['单文件'],
    todos: ['写初稿'],
  }
  const result = await run(store, {
    goal: '发布检查',
    verify: 'manual',
    handoff,
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }, engine)
  assert.equal(result.ok, true)
  assert.ok(bulletins.some(text => /交接单/.test(text) && /共识：先做最小版本/.test(text)))
})

test('a studio receipt becomes the chat room receipt and transfer record', async () => {
  const store = createStore({ dataDir: temp('lodge-receipt-data-') })
  const receipt = {
    result: '发布检查',
    completeness: '2/2 阶段完成',
    checks: ['npm test 通过'],
    openQuestions: ['是否需要自动回滚？'],
  }
  const result = await run(store, {
    goal: '评审这次交付：发布检查',
    roomType: 'chat',
    verify: 'manual',
    receipt,
    sourceRoomId: 'room-studio-source',
    sourceName: '发布检查',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.body.room.receipt, receipt)
  assert.equal(result.body.room.transfer.kind, 'receipt')
  assert.equal(result.body.room.transfer.fromRoomId, 'room-studio-source')
  assert.ok(result.body.room.transfer.at > 0)
})

test('studio creation keeps advisor off the main path', async () => {
  const store = createStore({ dataDir: temp('lodge-advisor-data-') })
  const ports = createCrewPorts()
  let calls = 0
  ports.advisor = { available: true, describe: () => ({ available: true, host: 'advisor.example' }), advice: async () => { calls += 1; return { available: true, advice: [] } } }
  const result = await createRealRoom({
    store,
    engine: fakeEngine(),
    live: fakeLive(),
    emit: () => {},
    body: {
      goal: '验证 Gate 不再调用 advisor',
      verify: 'manual',
      shadowReview: true,
      members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    },
    workspace: null,
    ports,
  })
  assert.equal(result.ok, true)
  assert.equal(calls, 0)
  assert.equal(result.body.room.gate.decision, 'allow')
  assert.equal('advice' in result.body.room.gate, false)
  assert.equal('advisor' in result.body.room.gate, false)
  assert.equal(result.body.room.shadowReview, true)
  assert.equal(result.body.room.advisorConsent.host, 'advisor.example')
})
