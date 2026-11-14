import assert from 'node:assert/strict'
import test from 'node:test'
import {
  dayKey,
  dayLabel,
  insertDayMarkers,
  groupSteps,
  describeSteps,
  showsSeat,
  presenceLines,
  displayableStep,
  stepLabel,
} from './transcript-model.js'

const step = (id, authorId, ts, ok = true, tool = 'Bash') => ({
  id, authorId, ts, seq: 1, kind: 'activity', text: tool, meta: { ok, tool },
})
const say = (id, authorId, ts) => ({ id, authorId, ts, seq: 1, kind: 'chat', text: 'hi' })

test('days are labelled today, yesterday and by date', () => {
  const now = new Date('2026-11-14T12:00:00').getTime()
  assert.equal(dayLabel(now, now), '今天')
  assert.equal(dayLabel(now - 86_400_000, now), '昨天')
  assert.equal(dayLabel(new Date('2026-03-02T09:00:00').getTime(), now), '3月2日')
  assert.equal(dayKey(now), '2026-11-14')
})

test('day markers are inserted once per local day', () => {
  const now = new Date('2026-11-14T12:00:00').getTime()
  const items = insertDayMarkers([say('a', 'w', now), say('b', 'w', now + 1000), say('c', 'w', now - 86_400_000)], now)
  assert.deepEqual(items.map(item => item.kind), ['day', 'chat', 'chat', 'day', 'chat'])
  assert.equal(items[0].label, '今天')
  assert.equal(items[3].label, '昨天')
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
  assert.equal(describeSteps(steps), '5 步 · Bash ×2、Read、Edit +1')
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
  assert.equal(describeSteps(items[0].steps), '2 步 · Bash ×2')
})

test('synthetic tool labels are rejected even when the projection carries them', () => {
  const synthetic = { ...step('s', 'w', 1), text: 'recent-work brief covers 1 private chat with you', meta: { ok: true, tool: "Verifierx's recent-work brief covers 1 private chat with you" } }
  assert.equal(displayableStep(synthetic), false)
  assert.equal(stepLabel(synthetic), '')
})
