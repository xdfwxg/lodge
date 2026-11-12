import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { roomDir } from './paths.js'
import { createCrewPorts } from './crew-ports.js'
import { createRealRoom } from './room-create.js'
import { writeBrief } from './room-repo.js'
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
  writeBrief(room)
  writeFileSync(join(roomDir(room), 'BRIEF.md'), [
    '# 目标：加一个导出按钮',
    '',
    'done:',
    '- [x] 按钮可用',
    '',
    'constraints:',
    '- 不改上游',
    '',
  ].join('\n'))
  store.appendMessage(room.id, { kind: 'system', text: '上一轮完成' })
  return { store, room }
}

const fakeEngine = () => ({
  capabilities: () => ({ provisioning: true, skills: false, mcp: false }),
  createSeatBot: async ({ name }) => ({ id: `seat-${name}`, name, engine: 'claude', model: 'claude-sonnet-5' }),
  createRoom: async ({ name }) => ({ id: `room-${name}`, sessionRef: `thread-${name}` }),
})

const fakeLive = () => ({
  attach: async () => {},
  startStage: async () => {},
  sendToSeat: async () => ({ messageId: null }),
})

const run = (store, body, engine = fakeEngine()) => createRealRoom({
  store,
  engine,
  live: fakeLive(),
  emit: () => {},
  dispatchPayload: () => null,
  body,
  ports: createCrewPorts(),
})

test('continuing a completed room creates a new room and inherits BRIEF done', async () => {
  const previous = process.env.CREW_WORKSPACE_ROOT
  const root = temp('lodge-resume-workspace-')
  process.env.CREW_WORKSPACE_ROOT = root
  try {
    const { store, room: source } = completedRoom(temp('lodge-resume-data-'))
    const repo = gitRepo()
    const result = await run(store, {
      goal: '在上一轮基础上继续',
      verify: 'test',
      acceptance: 'npm test',
      repoPath: repo,
      continueFrom: source.id,
      seats: [{ role: 'worker', name: '执行' }],
    })
    assert.equal(result.ok, true)
    const room = result.body.room
    assert.equal(room.continuedFrom.roomId, source.id)
    assert.equal(room.continuedFrom.name, '上一轮交付')
    assert.equal(room.workspace.provider, 'git')
    assert.equal(room.workspace.capabilities.vcs, 'git')
    assert.equal(room.stages[0].acceptance, 'npm test')
    assert.deepEqual(room.plan.done, ['按钮可用'])
    const messages = store.readMessages(room.id)
    assert.equal(messages.some(message => message.text?.includes('续做自交接记录')), true)
    assert.equal(store.readRoom(source.id).state, 'complete')
  } finally {
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})

test('parallel workers fail closed when the workspace cannot merge', async () => {
  const { store } = completedRoom(temp('lodge-resume-data-'))
  const workspace = {
    id: 'plain',
    capabilities: () => ({ vcs: 'none', isolation: 'copy', diff: 'manifest', candidate: false, merge: false, commit: false, acceptanceCopy: false }),
    probeSource: () => ({ ok: true }),
    prepareRoom: () => { throw new Error('should not prepare a workspace') },
    cleanupRoom: () => {},
  }
  const result = await createRealRoom({
    store,
    engine: fakeEngine(),
    live: fakeLive(),
    emit: () => {},
    dispatchPayload: () => null,
    workspace,
    ports: createCrewPorts(),
    body: {
      goal: '两个执行席位',
      verify: 'test',
      acceptance: 'npm test',
      repoPath: gitRepo(),
      seats: [{ role: 'worker', name: '甲' }, { role: 'worker', name: '乙' }],
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /不支持并行合并/)
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
      seats: [{ role: 'worker', name: '执行' }],
    })
    assert.equal(result.ok, true)
    const room = result.body.room
    assert.equal(room.workspace.provider, 'direct')
    assert.equal(room.workspace.capabilities.isolation, 'direct')
    assert.equal(room.workspace.capabilities.vcs, 'none')
    assert.equal(room.workspace.capabilities.commit, false)
    assert.equal(room.repoPath, source)
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

test('a plain room can run parallel workers into a copy integration', async () => {
  const root = temp('lodge-plain-parallel-')
  const source = join(root, 'docs')
  mkdirSync(source, { recursive: true })
  writeFileSync(join(source, 'README.md'), '# docs\n')
  const previousRoot = process.env.CREW_WORKSPACE_ROOT
  const previousCopy = process.env.CREW_COPY_ROOT
  process.env.CREW_WORKSPACE_ROOT = join(root, 'workspace')
  process.env.CREW_COPY_ROOT = join(root, 'copies')
  try {
    const store = createStore({ dataDir: temp('lodge-plain-parallel-data-') })
    const result = await run(store, {
      goal: '并行整理文档',
      verify: 'manual',
      repoPath: source,
      workspaceProvider: 'plain',
      seats: [{ role: 'worker', name: '甲' }, { role: 'worker', name: '乙' }],
    })
    assert.equal(result.ok, true)
    const room = result.body.room
    assert.equal(room.workspace.provider, 'plain')
    assert.equal(room.workspace.capabilities.merge, true)
    assert.equal(room.repoPath.endsWith('/integration'), true)
    assert.deepEqual(room.branches, {})
  } finally {
    if (previousRoot === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previousRoot
    if (previousCopy === undefined) delete process.env.CREW_COPY_ROOT
    else process.env.CREW_COPY_ROOT = previousCopy
    rmSync(root, { recursive: true, force: true })
  }
})

test('stage dependencies can be declared for a room', async () => {
  const { store } = completedRoom(temp('lodge-resume-data-'))
  const result = await run(store, {
    goal: '分两段做',
    verify: 'test',
    acceptance: 'npm test',
    repoPath: gitRepo(),
    seats: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }],
    stageDependencies: [[], [0]],
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.stages.length, 3)
  assert.deepEqual(room.stages.map(stage => stage.title), ['目标对齐', '分两段做', '验收与结论'])
  assert.equal(room.stages[0].state, 'active')
  assert.equal(room.stages[1].state, 'pending')
  assert.equal(room.stages[2].state, 'pending')
  assert.deepEqual(room.stages[1].dependsOn, [0])
  assert.deepEqual(room.stages[2].dependsOn, [1])
})

test('project constraints are snapshotted into the room and BRIEF', async () => {
  const { store } = completedRoom(temp('lodge-resume-data-'))
  const repo = gitRepo()
  writeFileSync(join(repo, 'LODGE.md'), '# 项目约定\n\n- 用 ESM\n- 不改上游\n')
  const result = await run(store, {
    goal: '按项目约定改一下',
    verify: 'manual',
    repoPath: repo,
    includeProjectConstraints: true,
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.projectConstraints.source, 'LODGE.md')
  assert.match(room.projectConstraints.content, /用 ESM/)
  const brief = readFileSync(join(roomDir(room), 'BRIEF.md'), 'utf8')
  assert.match(brief, /项目约束：用 ESM/)
  assert.match(brief, /项目约束：不改上游/)
})

test('an unknown workspace provider fails before creating anything', async () => {
  const { store } = completedRoom(temp('lodge-resume-data-'))
  const result = await run(store, {
    goal: '试试未知 provider',
    verify: 'manual',
    repoPath: gitRepo(),
    workspaceProvider: 'nope',
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'invalid')
})

test('continuing without a real repo and without a source room fail closed', async () => {
  const { store, room: source } = completedRoom(temp('lodge-resume-data-'))
  const missingRepo = await run(store, {
    goal: '继续',
    verify: 'test',
    acceptance: 'npm test',
    continueFrom: source.id,
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(missingRepo.ok, false)
  assert.equal(missingRepo.reason, 'invalid')

  const plain = { ...source, id: 'room-plain', state: 'stopped' }
  store.writeRoom(plain)
  const notImported = await run(store, {
    goal: '继续',
    verify: 'test',
    acceptance: 'npm test',
    repoPath: gitRepo(),
    continueFrom: 'room-plain',
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(notImported.ok, false)
  assert.equal(notImported.reason, 'conflict')
})

test('a plan with more than three questions is rejected, not silently trimmed', async () => {
  const { store } = completedRoom(temp('lodge-plan-limit-data-'))
  const result = await run(store, {
    goal: '验证开工卡问题上限',
    verify: 'test',
    acceptance: 'true',
    repoPath: gitRepo(),
    seats: [{ role: 'worker', name: '执行' }],
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
    seats: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }],
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
    seats: [{ role: 'worker', name: '执行' }],
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

test('a completed room can be used as a continuation source', async () => {
  const { store, room: completed } = completedRoom(temp('lodge-fork-data-'))
  const source = { ...completed, id: 'room-fork-source', state: 'complete' }
  store.writeRoom(source)
  mkdirSync(roomDir(source), { recursive: true })
  writeFileSync(join(roomDir(source), 'BRIEF.md'), [
    '# 目标：加一个导出按钮',
    '',
    'done:',
    '- [x] 按钮可用',
    '',
  ].join('\n'))
  const result = await run(store, {
    goal: '在已完成房间上继续',
    verify: 'test',
    acceptance: 'npm test',
    repoPath: gitRepo(),
    continueFrom: source.id,
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.body.room.continuedFrom.roomId, source.id)
  assert.deepEqual(result.body.room.plan.done, ['按钮可用'])
})

test('a plan can declare multiple work stages between alignment and acceptance', async () => {
  const { store } = completedRoom(temp('lodge-plan-stages-data-'))
  const result = await run(store, {
    goal: '多阶段拆解',
    verify: 'test',
    repoPath: gitRepo(),
    seats: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }],
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
    seats: [{ role: 'lead', name: '队长' }, { role: 'worker', name: '执行' }],
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

test('a roundtable room uses discussion stages and manual verification', async () => {
  const { store } = completedRoom(temp('lodge-roundtable-data-'))
  const result = await run(store, {
    goal: '评审这个方案',
    roomType: 'roundtable',
    repoPath: gitRepo(),
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.roomType, 'roundtable')
  assert.deepEqual(room.stages.map(stage => stage.title), ['圆桌讨论', '结论'])
  assert.deepEqual(room.stages.map(stage => stage.kind), ['decision', 'decision'])
  assert.deepEqual(room.stages.map(stage => stage.readOnly), [true, true])
  assert.equal(room.seatSpecs.length, 3)
  assert.equal(room.seatSpecs.every(seat => seat.approval === 'ask'), true)
  assert.equal(room.stages[0].state, 'active')
  assert.equal(room.stages[1].state, 'pending')
})

test('an archive room has one manual archive stage and one seat', async () => {
  const { store } = completedRoom(temp('lodge-archive-data-'))
  const result = await run(store, {
    goal: '归档这次交付',
    roomType: 'archive',
    repoPath: gitRepo(),
  })
  assert.equal(result.ok, true)
  const room = result.body.room
  assert.equal(room.roomType, 'archive')
  assert.deepEqual(room.stages.map(stage => stage.title), ['存档与交接'])
  assert.equal(room.stages[0].kind, 'decision')
  assert.equal(room.stages[0].state, 'active')
  assert.equal(room.seatSpecs.length, 1)
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

test('an active room can be forked into a new room without touching the source', async () => {
  const { store, room: completed } = completedRoom(temp('lodge-fork-active-data-'))
  const source = { ...completed, id: 'room-active-source', state: 'active' }
  store.writeRoom(source)
  mkdirSync(roomDir(source), { recursive: true })
  writeFileSync(join(roomDir(source), 'BRIEF.md'), [
    '# 目标：在做的房间',
    '',
    'done:',
    '- [ ] 分叉后继承这一条',
    '',
  ].join('\n'))
  const result = await run(store, {
    goal: '从进行中房间分叉',
    verify: 'test',
    acceptance: 'npm test',
    repoPath: gitRepo(),
    continueFrom: source.id,
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.body.room.continuedFrom.roomId, source.id)
  assert.deepEqual(result.body.room.plan.done, ['分叉后继承这一条'])
  assert.equal(store.readRoom(source.id).state, 'active')
})
