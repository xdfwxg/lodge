import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createCrewPorts } from './crew-ports.js'
import { buildHandoff as buildHandoffBase, HANDOFF_FORMAT } from './handoff.js'
import { roomDir } from './paths.js'
import { inheritedPlan } from './room-create.js'

const ports = createCrewPorts()
const buildHandoff = room => buildHandoffBase(room, { handoffStore: ports.handoff, workspaceRoot: ports.workspace.root() })

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
    seatSpecs: [{ id: 'executor', name: '执行者', role: 'worker', station: '写代码', permissions: { read: true } }],
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
    workspace: { provider: 'git', capabilities: { vcs: 'git', isolation: 'worktree', diff: 'patch', candidate: true, merge: true, commit: true, acceptanceCopy: true } },
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
  assert.equal(bundle.room.workspace.provider, 'git')
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

test('continuing from an existing room inherits the human BRIEF done items only', () => {
  const plan = inheritedPlan({
    done: [{ done: true, text: '按钮可用' }, { done: false, text: '补测试' }],
    constraints: ['不改上游'],
  }, '上一轮')
  assert.deepEqual(plan.done, ['按钮可用', '补测试'])
  assert.match(plan.why, /上一轮/)
  assert.equal(inheritedPlan({ done: [], constraints: [] }, '上一轮'), null)
})
