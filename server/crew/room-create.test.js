import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { createRealRoom } from './rooms/create/create.js'
import { createStore } from './store.js'
import { skillsForRole } from '../../shared/role-toolbox.js'

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
    stages: [{ title: '实现', kind: 'deliverable', state: 'passed' }],
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

const fakeEngine = ({ available = ['claude', 'pi', 'deepseek'] } = {}) => {
  const seatNames = []
  const skillAssignments = []
  return {
    seatNames,
    skillAssignments,
    capabilities: () => ({ provisioning: true, mentions: true, mcp: false }),
    createMemberBot: async ({ name, engine, model }) => {
      seatNames.push(name)
      const actual = engine !== undefined && available.includes(engine) ? engine : available[0]
      const actualModel = actual === engine && model !== undefined
        ? model
        : (actual === 'claude' ? 'claude-sonnet-5' : '')
      return { id: `member-${name}`, name, engine: actual, model: actualModel }
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

const run = (store, body, engine = fakeEngine(), workspace = null, parentRoom = null, ports = null) => createRealRoom({
  store,
  engine,
  live: fakeLive(),
  emit: () => {},
  body,
  workspace,
  ports: ports ?? createCrewPorts(),
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
  assert.deepEqual(engine.seatNames.filter(name => !name.startsWith('影子评审')).sort(), ['执行', '规划', '验收'].sort())
  assert.deepEqual(room.members.map(member => member.name).sort(), ['执行', '规划', '验收'].sort())
})

test('a studio starts with the planner alone and only the alignment stage', async () => {
  const { store } = completedRoom(temp('lodge-bootstrap-data-'))
  const engine = fakeEngine()
  const result = await run(store, { goal: '把启动说明写清楚', verify: 'manual' }, engine)
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.deepEqual(room.members.map(member => member.role), ['lead'])
  assert.deepEqual(room.stages.map(stage => stage.title), ['目标对齐'])
  assert.equal(room.stages[0].state, 'active')
  // 执行和验收等规划师组队后再开通，建房时不建多余的 bot。
  assert.deepEqual(engine.seatNames.filter(name => !name.startsWith('影子评审')), ['规划师'])
})

test('a handoff brief with a long topic names the stage after the task, not the paperwork', async () => {
  const { store } = completedRoom(temp('lodge-handoff-title-data-'))
  const topic = '用户列表要显示姓名缩写：中文和英文各定一条规则，最多两个字符；再定重名时怎么办。'
  const result = await run(store, {
    goal: topic,
    name: '姓名缩写',
    verify: 'test',
    handoffBrief: {
      topic,
      consensus: ['中文取声母', '英文取首字母'],
      disagreements: [],
      constraints: [],
      todos: [],
    },
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }, fakeEngine())
  assert.equal(result.ok, true)
  const stage = result.body.room.stages.find(item => item.kind === 'deliverable')
  assert.match(stage.title, /^用户列表要显示姓名缩写/)
  assert.doesNotMatch(stage.title, /完成交接简报/)
})

test('declared member skills are assigned to the created base member', async () => {
  const { store } = completedRoom(temp('lodge-skill-data-'))
  const engine = fakeEngine()
  const result = await run(store, {
    goal: '带一个复核技能',
    verify: 'manual',
    members: [
      { role: 'lead', name: '规划' },
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '验收', skills: ['evidence-review'] },
    ],
  }, engine)
  assert.equal(result.ok, true)
  assert.deepEqual(engine.skillAssignments, [
    { botId: 'member-规划', skills: skillsForRole('lead') },
    { botId: 'member-执行', skills: skillsForRole('worker') },
    { botId: 'member-验收', skills: [...skillsForRole('verifier'), 'evidence-review'] },
  ])
  assert.deepEqual(
    result.body.room.members.find(member => member.name === '验收').body.spec.skills,
    [...skillsForRole('verifier'), 'evidence-review'],
  )
})

test('member skills fail before creating anything when the base library is off', async () => {
  const { store } = completedRoom(temp('lodge-skill-off-data-'))
  const engine = { ...fakeEngine(), features: async () => ({ skillsLibrary: false }) }
  const result = await run(store, {
    goal: '带一个复核技能',
    verify: 'manual',
    members: [
      { role: 'lead', name: '规划' },
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '验收', skills: ['evidence-review'] },
    ],
  }, engine)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /技能库/)
  assert.deepEqual(engine.seatNames, [])
})

test('role skills fail before creating anything when the packs are not ready', async () => {
  const { store } = completedRoom(temp('lodge-role-pack-off-data-'))
  const engine = fakeEngine()
  const result = await run(store, {
    goal: '角色技能包没准备好',
    verify: 'manual',
  }, engine, null, null, {
    ...createCrewPorts(),
    roleSkills: { ready: async () => false },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /角色技能/)
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
  writeFileSync(join(source, '.env'), 'TOKEN=secret\n')
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
    const verifierPath = room.worktrees.verifier
    assert.notEqual(verifierPath, source)
    assert.equal(existsSync(join(verifierPath, 'README.md')), true)
    assert.equal(existsSync(join(verifierPath, '.env')), false)
    assert.equal(existsSync(join(root, 'copies')), true)
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

test('a supplied plan with independent packages creates a parallel room', async () => {
  const { store } = completedRoom(temp('lodge-parallel-plan-data-'))
  const result = await run(store, {
    goal: '两个独立文件',
    verify: 'test',
    repoPath: gitRepo(),
    members: [
      { role: 'lead', name: '队长' },
      { role: 'worker', name: '执行甲' },
      { role: 'worker', name: '执行乙' },
      { role: 'verifier', name: '验收' },
    ],
    plan: {
      contract: {
        outcomes: [
          { id: 'a', statement: 'a.txt 有 A', observable: 'a.txt 包含 A' },
          { id: 'b', statement: 'b.txt 有 B', observable: 'b.txt 包含 B' },
        ],
        boundaries: ['只改两个文件'],
        nonGoals: ['不改其他文件'],
      },
      stages: [{
        title: '写两个文件',
        deliverable: '两个文件各一行',
        clauseIds: ['a', 'b'],
        packages: [
          { title: '写 a', files: ['a.txt'], clauseIds: ['a'] },
          { title: '写 b', files: ['b.txt'], clauseIds: ['b'] },
        ],
      }],
    },
  })
  assert.equal(result.ok, true, result.error)
  assert.equal(result.body.room.orchestration, 'parallel')
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
        { title: '实现', deliverable: '功能可用' },
        { title: '回归', deliverable: '回归通过' },
      ],
    },
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.deepEqual(room.stages.map(stage => stage.title), ['目标对齐', '实现', '回归', '验收与结论'])
  assert.deepEqual(room.stages.map(stage => stage.state), ['passed', 'active', 'pending', 'pending'])
  assert.equal(room.stages[2].deliverable, '回归通过')
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

test('a chat room has a fixed four-per-round cap and no trust ladder', async () => {
  const { store } = completedRoom(temp('lodge-chat-rules-data-'))
  const engine = fakeEngine()
  const result = await run(store, {
    goal: '圆桌讨论一下交付边界',
    roomType: 'chat',
  }, engine)
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.chat.turnLimit, 4)
  assert.equal('trust' in room, false)
  assert.equal('stages' in room, false)
  // 聊天室自带固定六人班底；建房时不再让人挑人。
  assert.deepEqual(room.members.map(member => member.name), ['老周', '小林', '阿岚', '大陈', '苏越', '韩工'])
  assert.deepEqual(room.members.map(member => member.permissions), Array(6).fill({ read: true, exec: false, write: false }))
  assert.deepEqual(room.members.map(member => member.body.spec.skills), Array(6).fill([]))
  assert.deepEqual(room.members.map(member => member.stance), ['proposer', 'critic', 'synthesizer', 'synthesizer', 'critic', 'critic'])
  assert.deepEqual(room.members.map(member => member.voice), [
    '先问方向，再问代价。',
    '先找漏洞，再谈信心。',
    '先说场景，再说感受。',
    '先问能不能落地。',
    '先看长期代价。',
    '先看边界之外。',
  ])
  assert.deepEqual(engine.skillAssignments, [])
})

test('studio and chat both close member reply mentions', async () => {
  const calls = []
  const engine = fakeEngine()
  const createRoom = engine.createRoom
  engine.createRoom = async args => {
    calls.push(args)
    return createRoom(args)
  }
  const studio = await run(completedRoom(temp('lodge-studio-mentions-')).store, {
    goal: 'studio goal',
    roomType: 'studio',
    verify: 'manual',
    members: [
      { role: 'lead', name: '规划' },
      { role: 'worker', name: '执行' },
      { role: 'verifier', name: '验收' },
    ],
  }, engine)
  const chat = await run(completedRoom(temp('lodge-chat-mentions-')).store, {
    goal: 'chat goal',
    roomType: 'chat',
  }, engine)
  assert.equal(studio.ok, true)
  assert.equal(chat.ok, true)
  const mainRoom = goal => calls.find(call => call.goal === goal && call.responder !== undefined)
  assert.equal(mainRoom('studio goal')?.followMentions, false)
  assert.equal(mainRoom('chat goal')?.followMentions, false)
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
  assert.equal(members[0].body.engine, 'pi')
  assert.equal(members[0].body.model, 'deepseek/deepseek-flash')
  assert.equal(members[0].name, '甲')
})

test('a single-vendor studio records the downgrade', async () => {
  const { store } = completedRoom(temp('lodge-independence-prefer-'))
  const engine = fakeEngine({ available: ['claude'] })
  engine.capabilities = () => ({ provisioning: true, mentions: true, mcp: false })
  engine.instances = async () => [{ id: 'claude', engine: 'claude', available: true, capabilities: { approvalReview: true } }]
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
  const handoffBrief = {
    topic: '发布前检查',
    consensus: ['先做最小版本'],
    disagreements: ['是否自动回滚'],
    constraints: ['单文件'],
    todos: ['写初稿'],
  }
  const body = {
    goal: '发布前检查',
    verify: 'manual',
    handoffBrief,
    sourceRoomId: 'room-chat-source',
    sourceName: '圆桌',
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }
  const rejected = await run(store, body)
  assert.equal(rejected.ok, false)
  assert.equal(rejected.reason, 'invalid')
  assert.match(rejected.error, /待确认/)

  const accepted = await run(store, { ...body, handoffBriefReviewed: true })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.body.room.gate.humanReviewed, true)
  assert.ok(accepted.body.room.gate.reviewedAt > 0)
  assert.equal(accepted.body.room.handoffBrief.disagreements[0], '是否自动回滚')
  assert.equal(accepted.body.room.transfer.kind, 'handoff')
  assert.equal(accepted.body.room.transfer.fromRoomId, 'room-chat-source')
  assert.equal(accepted.body.room.transfer.fromRoomName, '圆桌')
})

test('a long handoff brief topic becomes a short delivery step', async () => {
  const store = createStore({ dataDir: temp('lodge-handoff-stage-data-') })
  const handoffBrief = {
    topic: '把欢迎语写进 WELCOME.md，并保证任何新成员第一次进来就能看见',
    consensus: ['单句中文'],
    disagreements: [],
    constraints: ['不超过 20 字'],
    todos: ['定稿'],
  }
  const result = await run(store, {
    goal: handoffBrief.topic,
    verify: 'manual',
    handoffBrief,
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.body.room.stages.map(stage => stage.title), [
    '写入 WELCOME.md',
    '验收与结论',
  ])
})

test('a handoff brief reaches the member bulletin and the opening prompt', async () => {
  const store = createStore({ dataDir: temp('lodge-handoff-bulletin-data-') })
  const bulletins = []
  const engine = fakeEngine()
  const createRoom = engine.createRoom
  engine.createRoom = async args => {
    bulletins.push(args.bulletin ?? '')
    return createRoom(args)
  }
  const handoffBrief = {
    topic: '发布检查',
    consensus: ['先做最小版本'],
    disagreements: [],
    constraints: ['单文件'],
    todos: ['写初稿'],
  }
  const result = await run(store, {
    goal: '发布检查',
    verify: 'manual',
    handoffBrief,
    members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
  }, engine)
  assert.equal(result.ok, true)
  assert.ok(bulletins.some(text => /交接简报/.test(text) && /共识：先做最小版本/.test(text)))
})

test('a studio receipt becomes the chat room receipt and transfer record', async () => {
  const store = createStore({ dataDir: temp('lodge-receipt-data-') })
  const receipt = {
    result: '发布检查',
    completeness: '2/2 阶段完成',
    checks: ['npm test 通过'],
    paths: [],
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

test('studio creation puts the shadow reviewer in a hidden bot, not the gate', async () => {
  const store = createStore({ dataDir: temp('lodge-shadow-data-') })
  const result = await createRealRoom({
    store,
    engine: fakeEngine(),
    live: fakeLive(),
    emit: () => {},
    body: {
      goal: '验证影子评审不进主链路',
      verify: 'manual',
      shadowReview: true,
      members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    },
    workspace: null,
    ports: createCrewPorts(),
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.shadowReview, true)
  assert.ok(room.shadowBot?.memberRef)
  assert.equal(room.members.some(member => member.body?.ref === room.shadowBot.memberRef), false)
  assert.equal(room.gate.decision, 'allow')
  assert.equal('advice' in room.gate, false)
  assert.equal('advisor' in room.gate, false)
})

test('studio creation always brings a hidden shadow reviewer', async () => {
  const store = createStore({ dataDir: temp('lodge-shadow-off-data-') })
  const result = await createRealRoom({
    store,
    engine: fakeEngine(),
    live: fakeLive(),
    emit: () => {},
    body: {
      goal: '不勾影子评审',
      verify: 'manual',
      members: [{ role: 'lead', name: '规划' }, { role: 'worker', name: '执行' }, { role: 'verifier', name: '验收' }],
    },
    workspace: null,
    ports: createCrewPorts(),
  })
  assert.equal(result.ok, true)
  assert.equal(typeof result.body.room.shadowBot?.memberRef, 'string')
  assert.notEqual(result.body.room.shadowReview, true)
})