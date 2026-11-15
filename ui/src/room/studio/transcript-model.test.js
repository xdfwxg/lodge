import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dayKey,
  groupSteps,
  describeSteps,
  showsSeat,
  presenceLines,
  displayableStep,
  stepLabel,
  buildStageChapters,
  stageChapterSummary,
} from './transcript-model.js'

const step = (id, authorId, ts, ok = true, tool = 'Bash') => ({
  id, authorId, ts, seq: 1, kind: 'activity', text: tool, meta: { ok, tool },
})
const say = (id, authorId, ts) => ({ id, authorId, ts, seq: 1, kind: 'chat', text: 'hi' })

test('day keys use the local calendar day', () => {
  const now = new Date('2026-11-14T12:00:00').getTime()
  assert.equal(dayKey(now), '2026-11-14')
  assert.equal(dayKey(Number.NaN), null)
})

test('two consecutive ok steps fold into one step group, one stays a message', () => {
  const items = groupSteps([step('1', 'w', 1), step('2', 'w', 2), say('m', 'w', 3), step('3', 'w', 4)])
  assert.deepEqual(items.map(item => item.kind ?? 'message'), ['steps', 'chat', 'activity'])
  assert.equal(items[0].steps.length, 2)
})

test('a failed step and a speaker change break the group', () => {
  assert.deepEqual(groupSteps([step('1', 'w', 1), step('2', 'w', 2, false)]).map(item => item.kind === 'activity' ? 'single' : item.kind), ['single', 'single'])
  assert.deepEqual(groupSteps([step('1', 'w', 1), step('2', 'v', 2)]).map(item => item.kind === 'activity' ? 'single' : item.kind), ['single', 'single'])
})

test('a day marker breaks the group', () => {
  const items = groupSteps([
    step('1', 'w', 1),
    { kind: 'day', key: 'day-x', ts: 2, label: '昨天' },
    step('2', 'w', 3),
  ])
  assert.deepEqual(items.map(item => item.kind === 'activity' ? 'single' : item.kind), ['single', 'day', 'single'])
})

test('step-group summaries count repeated tools and cap the list', () => {
  const steps = [
    step('1', 'w', 1), step('2', 'w', 2),
    step('3', 'w', 3, true, 'Read'),
    step('4', 'w', 4, true, 'Edit'),
    step('5', 'w', 5, true, 'Grep'),
  ]
  assert.equal(describeSteps(steps), '5 步 · 运行命令 ×2、读取文件、修改文件 +1')
})

test('only the first message of a same-seat group shows a speaker', () => {
  const items = [say('a', 'w', 1), say('b', 'w', 2), say('c', 'v', 3)]
  assert.deepEqual(items.map((_, index) => showsSeat(items, index)), [true, false, true])
})

test('a day marker and a same-seat step group start a new group', () => {
  const afterDay = [{ kind: 'day', key: 'd', ts: 0, label: '今天' }, say('a', 'w', 1)]
  assert.equal(showsSeat(afterDay, 1), true)
  const afterGroup = [{ kind: 'steps', key: 'r', authorId: 'w', ts: 0, steps: [] }, say('a', 'w', 1)]
  assert.equal(showsSeat(afterGroup, 1), false)
})

test('presence lines name seats and describe queue position', () => {
  const seats = [{ id: 'lead', name: '规划师' }, { id: 'worker', name: '执行官' }, { id: 'verifier', name: '验收员' }]
  const lines = presenceLines({
    busySince: 10,
    presence: [{ seatId: 'lead', state: 'working' }],
    turnQueue: [
      { seatId: 'lead', state: 'running', position: 1, of: 3 },
      { seatId: 'verifier', state: 'queued', position: 3, of: 3, waitingForSeatId: 'worker' },
    ],
  }, seats)
  assert.deepEqual(lines.working, [{ seatId: 'lead', name: '规划师', since: 10 }])
  assert.deepEqual(lines.queued, [{ seatId: 'verifier', name: '验收员', position: 3, of: 3, waitingFor: '执行官' }])
})

test('activity without a tool name is skipped without breaking the run', () => {
  const noise = { id: 'n', authorId: 'w', ts: 2, seq: 1, kind: 'activity', text: "executor's recent-work brief covers 1 private chat with you", meta: { ok: true } }
  assert.equal(displayableStep(noise), false)
  const items = groupSteps([step('1', 'w', 1), noise, step('3', 'w', 3)])
  assert.equal(items.length, 1)
  assert.equal(items[0].kind, 'steps')
  assert.equal(items[0].steps.length, 2)
})

test('the projection tool name is the only step label', () => {
  const tool = { ...step('t', 'w', 1), text: "executor's recent-work brief covers 1 private chat with you", meta: { ok: true, tool: 'Bash' } }
  assert.equal(stepLabel(tool), 'Bash')
  assert.equal(displayableStep(tool), true)
  const items = groupSteps([tool, { ...tool, id: 't2', ts: 2 }])
  assert.equal(items[0].kind, 'steps')
  assert.equal(describeSteps(items[0].steps), '2 步 · 运行命令 ×2')
})

test('synthetic tool labels are rejected even when the projection carries them', () => {
  const synthetic = { ...step('s', 'w', 1), text: 'recent-work brief covers 1 private chat with you', meta: { ok: true, tool: "Verifierx's recent-work brief covers 1 private chat with you" } }
  assert.equal(displayableStep(synthetic), false)
  assert.equal(stepLabel(synthetic), '')
})

const stagedRoom = (states = ['passed', 'active', 'pending']) => ({
  leadSeat: 'lead',
  stages: states.map((state, index) => ({ title: `阶段${index + 1}`, state })),
})

const staged = (id, ts, stage, kind = 'chat', meta = {}) => ({
  id, ts, seq: 1, kind, authorId: 'lead', text: 'x', meta: { stage, ...meta },
})

test('stage chapters expand the active stage and compress passed stages', () => {
  const room = stagedRoom()
  const chapters = buildStageChapters([
    staged('chat-0', 1, 0),
    staged('dispatch-0', 2, 0, 'dispatch'),
    staged('evidence-0', 3, 0, 'evidence'),
    staged('chat-1', 4, 1),
    staged('evidence-1', 5, 1, 'evidence'),
    staged('verdict-1', 6, 1, 'verdict', { pass: true }),
  ], room)
  assert.deepEqual(chapters.map(chapter => chapter.index), [0, 1])
  assert.deepEqual(chapters.map(chapter => chapter.expanded), [false, true])
  assert.match(chapters[0].summary, /1 次交接/)
  assert.match(chapters[0].summary, /1 条证据/)
  assert.match(chapters[1].summary, /1 条证据 · 1 次复核/)
})

test('pre-stage room notices stay out of the first stage', () => {
  const room = stagedRoom(['passed', 'passed'])
  const chapters = buildStageChapters([
    { id: 'notice', ts: 1, seq: 1, kind: 'system', text: '引擎降级' },
    staged('dispatch', 2, 1, 'dispatch'),
    staged('evidence', 3, 1, 'evidence'),
  ], room)
  assert.deepEqual(chapters.map(chapter => chapter.index), [-1, 1])
  assert.equal(chapters[0].kind, 'prelude')
  assert.equal(chapters[0].title, '准备')
  assert.deepEqual(chapters[1].items.map(item => item.id), ['dispatch', 'evidence'])
})

test('conversation after a pre-stage notice belongs to the active stage', () => {
  const room = stagedRoom(['active', 'pending'])
  const chapters = buildStageChapters([
    { id: 'notice', ts: 1, seq: 1, kind: 'system', text: '引擎降级' },
    { id: 'goal', ts: 2, seq: 2, kind: 'chat', authorId: 'lead', text: '目标对齐', meta: {} },
    { id: 'activity', ts: 3, seq: 3, kind: 'activity', authorId: 'lead', text: 'Bash', meta: { ok: true } },
  ], room)
  assert.deepEqual(chapters.map(chapter => chapter.index), [-1, 0])
  assert.equal(chapters[1].expanded, true)
  assert.deepEqual(chapters[1].items.map(item => item.id), ['goal', 'activity'])
})

test('empty stages do not create a chapter', () => {
  const chapters = buildStageChapters([staged('work', 1, 2, 'dispatch')], stagedRoom(['passed', 'passed', 'active']))
  assert.deepEqual(chapters.map(chapter => chapter.index), [2])
})

test('a complete room expands its last stage and compresses the rest', () => {
  const chapters = buildStageChapters([
    staged('a', 1, 0, 'evidence'),
    staged('b', 2, 1, 'evidence'),
  ], stagedRoom(['passed', 'passed']))
  assert.deepEqual(chapters.map(chapter => chapter.expanded), [false, true])
})

test('a complete room expands the last working stage, not the closing record', () => {
  const chapters = buildStageChapters([
    staged('e', 1, 0, 'evidence'),
    staged('c', 2, 1, 'conclusion'),
  ], stagedRoom(['passed', 'passed']))
  assert.deepEqual(chapters.map(chapter => chapter.expanded), [true, false])
})

test('a room without stages keeps one process chapter', () => {
  const chapters = buildStageChapters([say('a', 'w', 1)], { stages: [] })
  assert.equal(chapters.length, 1)
  assert.equal(chapters[0].index, -1)
  assert.equal(chapters[0].title, '过程')
  assert.equal(chapters[0].expanded, true)
})

test('stage summaries stay quiet when there is nothing to count', () => {
  const room = stagedRoom(['passed'])
  assert.equal(stageChapterSummary([staged('a', 1, 0)], room), '')
  assert.equal(
    stageChapterSummary([staged('v', 1, 0, 'verdict', { human: true })], room),
    '',
  )
})

test('stage summaries count evidence and verdicts from the full room history', () => {
  const room = {
    ...stagedRoom(['passed']),
    messages: [
      staged('e', 1, 0, 'evidence'),
      staged('v', 2, 0, 'verdict', { pass: true }),
    ],
  }
  assert.equal(stageChapterSummary([], room, 0), '1 条证据 · 1 次复核')
})

test('MCP tool names are shortened in the step summary', () => {
  const steps = [
    { id: 's1', kind: 'activity', meta: { tool: 'mcp__agents__session_search', ok: true } },
    { id: 's2', kind: 'activity', meta: { tool: 'mcp__agents__session_search', ok: true } },
    { id: 's3', kind: 'activity', meta: { tool: 'Bash', ok: true } },
  ]
  assert.equal(describeSteps(steps), '3 步 · session_search ×2、运行命令')
})
