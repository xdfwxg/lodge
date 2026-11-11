import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { roomDir } from './paths.js'
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

const importedRoom = dataDir => {
  const store = createStore({ dataDir })
  const archive = join(dataDir, 'imported', 'room-import-test')
  const room = {
    id: 'room-import-test',
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
    imported: true,
    readOnly: true,
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

const run = (store, body) => createRealRoom({
  store,
  engine: fakeEngine(),
  live: fakeLive(),
  emit: () => {},
  dispatchPayload: () => null,
  body,
})

test('continuing a handoff creates a new room and inherits BRIEF done', async () => {
  const previous = process.env.CREW_WORKSPACE_ROOT
  const root = temp('lodge-resume-workspace-')
  process.env.CREW_WORKSPACE_ROOT = root
  try {
    const { store, room: source } = importedRoom(temp('lodge-resume-data-'))
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
    assert.equal(store.readRoom(source.id).readOnly, true)
  } finally {
    if (previous === undefined) delete process.env.CREW_WORKSPACE_ROOT
    else process.env.CREW_WORKSPACE_ROOT = previous
  }
})

test('parallel workers fail closed when the workspace cannot merge', async () => {
  const { store } = importedRoom(temp('lodge-resume-data-'))
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

test('continuing without a real repo and without a handoff record fail closed', async () => {
  const { store, room: source } = importedRoom(temp('lodge-resume-data-'))
  const missingRepo = await run(store, {
    goal: '继续',
    verify: 'test',
    acceptance: 'npm test',
    continueFrom: source.id,
    seats: [{ role: 'worker', name: '执行' }],
  })
  assert.equal(missingRepo.ok, false)
  assert.equal(missingRepo.reason, 'invalid')

  const plain = { ...source, id: 'room-plain', imported: false, readOnly: false }
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
