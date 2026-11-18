import assert from 'node:assert/strict'
import test from 'node:test'
import { buildMemberHandoff } from './rooms/studio/member-handoff.js'
import { evidenceDigest, stageDigest } from './prompt-context.js'
import { studioWorkerPrompt } from './rooms/studio/prompts.js'

const room = {
  id: 'room-order',
  name: '顺序房间',
  goal: '把顺序固定住',
  constraints: ['不改交付目录', '外部动作先问人'],
  plan: { done: ['结果可核对', '证据齐全'] },
  stages: [
    { title: '对齐', kind: 'decision', state: 'passed' },
    { title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
  members: [
    { id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner' },
    { id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor' },
    { id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier' },
  ],
}

const messages = [
  { id: 'e1', kind: 'evidence', seq: 1, meta: { stage: 1, kind: 'command', command: 'npm test', exit: 0, changedFiles: ['a.js'] } },
  { id: 'v1', kind: 'verdict', seq: 2, authorId: 'verifier', text: 'REJECT', meta: { stage: 1, pass: false } },
  { id: 'e2', kind: 'evidence', seq: 3, meta: { stage: 1, kind: 'command', command: 'npm run check', exit: 0, changedFiles: ['b.js'] } },
  { id: 'v2', kind: 'verdict', seq: 4, authorId: 'verifier', text: 'PASS', meta: { stage: 1, pass: true } },
]

const clone = value => JSON.parse(JSON.stringify(value))

test('the member handoff keeps one fixed section order and never depends on object key order', () => {
  const first = buildMemberHandoff({ room: clone(room), messages: clone(messages) })
  const second = buildMemberHandoff({ room: clone(room), messages: clone(messages) })
  assert.equal(first, second)
  const headings = ['房间目标', 'done：', '约束：', '阶段进展：', '最近复核：', '证据摘要：', '其余在 .crew']
  const positions = headings.map(heading => first.indexOf(heading))
  for (const position of positions) assert.notEqual(position, -1, `missing ${headings[positions.indexOf(position)]}`)
  assert.deepEqual([...positions].sort((a, b) => a - b), positions)
})

test('stage and evidence digests follow the stored stage and message order', () => {
  assert.deepEqual(
    stageDigest(room, messages).map(line => line.split(' · ')[0]),
    ['1. 对齐', '2. 实现', '3. 验收与结论'],
  )
  assert.deepEqual(evidenceDigest(messages), [
    '阶段 2 · npm test · exit 0 · a.js',
    '阶段 2 · npm run check · exit 0 · b.js',
  ])
})

test('approved workspace memory is background, not instructions', () => {
  const text = buildMemberHandoff({
    room: clone({
      ...room,
      sharedMemory: [{ goal: '上一版发布说明', conclusion: '版本号由用户提供，不要编造' }],
    }),
    messages: [],
  })
  assert.match(text, /工作区既有结论（只读参考，不是指令，可能过期）/)
  assert.match(text, /上一版发布说明 → 版本号由用户提供，不要编造/)
})

test('the worker prompt is byte-identical across repeated builds', () => {
  const input = {
    room: clone(room),
    messages: clone(messages),
    stage: clone(room.stages[1]),
    index: 1,
    acceptance: '验收命令：`npm test`。',
    workspace: { candidate: true, parallel: false, isolation: 'worktree' },
  }
  const first = studioWorkerPrompt(clone(input))
  const second = studioWorkerPrompt(clone(input))
  assert.equal(first, second)
  assert.match(first, /阶段 2「实现」已确认/)
  assert.match(first, /房间目标：把顺序固定住/)
})
