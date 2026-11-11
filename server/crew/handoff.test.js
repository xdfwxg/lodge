import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { budgetSummary } from './budget.js'
import { buildHandoff, HANDOFF_FORMAT, importHandoff } from './handoff.js'
import { roomDir } from './paths.js'
import { inheritedPlan } from './room-create.js'
import { createCrewService } from './service.js'
import { createStore } from './store.js'

const workspace = () => mkdtempSync(join(tmpdir(), 'lodge-handoff-'))

const roomWithFiles = () => {
  const repo = workspace()
  const room = {
    id: 'room-abc123',
    kind: 'room',
    name: '加一个导出按钮',
    goal: '在房间页加一个导出按钮，并用 npm test 验收',
    state: 'complete',
    stages: [{ title: '实现', kind: 'deliverable', state: 'passed', acceptance: 'npm test' }],
    constraints: ['不改上游'],
    seatSpecs: [{ id: 'executor', name: '执行', role: 'worker', station: '写代码', permissions: { read: true } }],
    workers: ['executor'],
    verifiers: [],
    branch: 'lodge/room-abc123',
    branches: {},
    engines: { executor: 'claude' },
    engineFallbacks: {},
    usage: { costMicroUsd: 1200, budgetMicroUsd: 5_000_000, turns: 2 },
    repoPath: repo,
    sourceRepo: join(repo, 'source'),
    worktrees: { executor: join(repo, 'seat-executor') },
    demo: false,
    live: true,
  }
  const dir = roomDir(room)
  mkdirSync(join(dir, 'evidence'), { recursive: true })
  writeFileSync(join(dir, 'BRIEF.md'), '# 目标：加一个导出按钮\n\ndone:\n- [x] 按钮可用\n')
  writeFileSync(join(dir, 'GOAL.md'), `# 目标投影\n\n仓库：${repo}\n源仓库：${room.sourceRepo}\n`)
  writeFileSync(join(dir, 'CONCLUSION.md'), `# 结论\n\n- 目标仓库：${repo}\n`)
  writeFileSync(join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'room.complete' })}\n`)
  writeFileSync(join(dir, 'evidence', 'm1.json'), JSON.stringify({ command: 'npm test', exit: 0, commandCwd: repo }))
  const messages = [
    { id: 'm1', kind: 'evidence', text: 'npm test 通过', meta: { stage: 0, kind: 'command', command: 'npm test', exit: 0 } },
    { id: 'm2', kind: 'system', text: `源仓库 ${room.sourceRepo}` },
  ]
  writeFileSync(join(dir, 'transcript.jsonl'), `${messages.map(message => JSON.stringify(message)).join('\n')}\n`)
  return { room, messages }
}

test('a handoff bundle carries the room record without local paths', () => {
  const { room } = roomWithFiles()
  const bundle = buildHandoff(room)
  assert.equal(bundle.format, HANDOFF_FORMAT)
  assert.equal(bundle.room.name, room.name)
  assert.equal(bundle.room.repoPath, undefined)
  assert.equal(bundle.room.sourceRepo, undefined)
  assert.equal(bundle.room.worktrees, undefined)
  assert.equal(bundle.files['BRIEF.md'].includes('加一个导出按钮'), true)
  assert.equal(bundle.files['GOAL.md'].includes(room.repoPath), false)
  assert.equal(bundle.files['evidence/m1.json'].includes(room.repoPath), false)
  assert.equal(bundle.files['transcript.jsonl'].includes(room.sourceRepo), false)
  assert.deepEqual(Object.keys(bundle.files).sort(), [
    'BRIEF.md', 'CONCLUSION.md', 'GOAL.md', 'events.jsonl', 'evidence/m1.json', 'transcript.jsonl',
  ])
})

test('a room without a transcript cannot be exported', () => {
  const repo = workspace()
  assert.equal(buildHandoff({ id: 'room-empty', repoPath: repo }), null)
})

test('imported handoff opens as a read-only room and keeps the transcript', () => {
  const { room, messages } = roomWithFiles()
  const bundle = buildHandoff(room)
  const dataDir = workspace()
  const store = createStore({ dataDir })
  const result = importHandoff({ store, dataDir, bundle })
  assert.equal(result.ok, true)
  assert.equal(result.room.imported, true)
  assert.equal(result.room.readOnly, true)
  assert.equal(result.room.state, 'complete')
  assert.match(result.room.id, /^room-import-/)
  assert.equal(result.room.usage.costMicroUsd, 1200)
  const dir = roomDir(result.room)
  assert.equal(readFileSync(join(dir, 'BRIEF.md'), 'utf8').includes('加一个导出按钮'), true)
  assert.equal(readFileSync(join(dir, 'evidence', 'm1.json'), 'utf8').includes('npm test'), true)
  const stored = store.readMessages(result.room.id)
  assert.deepEqual(stored.map(message => message.id), messages.map(message => message.id))
  assert.deepEqual(stored.map(message => message.roomId), [result.room.id, result.room.id])
  assert.notEqual(stored[0].seq, stored[1].seq)
})

test('importing the same package twice is refused', () => {
  const { room } = roomWithFiles()
  const bundle = buildHandoff(room)
  const dataDir = workspace()
  const store = createStore({ dataDir })
  assert.equal(importHandoff({ store, dataDir, bundle }).ok, true)
  const again = importHandoff({ store, dataDir, bundle })
  assert.equal(again.ok, false)
  assert.equal(again.reason, 'conflict')
})

test('handoff validation rejects unsafe files and broken transcripts', () => {
  const { room } = roomWithFiles()
  const bundle = buildHandoff(room)
  const dataDir = workspace()
  const store = createStore({ dataDir })

  const traversal = structuredClone(bundle)
  traversal.files['../secret.txt'] = 'x'
  assert.equal(importHandoff({ store, dataDir, bundle: traversal }).reason, 'invalid')

  const broken = structuredClone(bundle)
  broken.files['transcript.jsonl'] = '{not json}\n'
  assert.equal(importHandoff({ store, dataDir, bundle: broken }).reason, 'invalid')

  const wrongFormat = structuredClone(bundle)
  wrongFormat.format = 'other'
  assert.equal(importHandoff({ store, dataDir, bundle: wrongFormat }).reason, 'invalid')

  const duplicate = structuredClone(bundle)
  duplicate.files['transcript.jsonl'] = `${JSON.stringify({ id: 'same', kind: 'system' })}\n${JSON.stringify({ id: 'same', kind: 'system' })}\n`
  assert.equal(importHandoff({ store, dataDir, bundle: duplicate }).reason, 'invalid')
})

test('continuing a handoff inherits the human BRIEF done items only', () => {
  const plan = inheritedPlan({
    done: [{ done: true, text: '按钮可用' }, { done: false, text: '补测试' }],
    constraints: ['不改上游'],
  }, '上一轮')
  assert.deepEqual(plan.done, ['按钮可用', '补测试'])
  assert.match(plan.why, /上一轮/)
  assert.equal(inheritedPlan({ done: [], constraints: [] }, '上一轮'), null)
})

test('imported handoff records do not consume the current budget', () => {
  assert.deepEqual(budgetSummary([
    { usage: { costMicroUsd: 500 } },
    { imported: true, usage: { costMicroUsd: 9000 } },
  ]).globalSpentMicroUsd, 500)
})

test('an imported handoff rejects every room action', async () => {
  const { room } = roomWithFiles()
  const bundle = buildHandoff(room)
  const dataDir = workspace()
  const store = createStore({ dataDir })
  const imported = importHandoff({ store, dataDir, bundle }).room
  const service = createCrewService({
    store,
    engine: {},
    live: {},
    emit: () => {},
    dispatchPayload: () => null,
    seats: [],
    dataDir,
  })
  const result = await service.roomRequest(imported.id, 'pause', { method: 'POST' })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'conflict')
  assert.match(result.error, /交接记录只读/)
})
