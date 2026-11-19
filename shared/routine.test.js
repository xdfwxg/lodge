import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ROUTINE_CADENCE,
  catchUpRoutineAt,
  nextRoutineAt,
  parseCadence,
  parseClock,
  routineDueNow,
  routineLineOf,
  routineNextLabel,
  routineOf,
  scheduleLabelOf,
} from './routine.js'

test('a routine is a room property with a daily rhythm', () => {
  assert.deepEqual(routineOf({ routine: { cadence: 'daily', enabled: true, hour: 8, minute: 0 } }), {
    cadence: ROUTINE_CADENCE.DAILY,
    hour: 8,
    minute: 0,
    enabled: true,
    updatedAt: null,
    lastRunAt: null,
    lastFinishedAt: null,
    nextRunAt: null,
    lastRoomId: null,
    runIds: [],
    failures: 0,
    paused: false,
    skippedAt: null,
    lastError: '',
    unseenResult: false,
  })
  assert.equal(parseCadence('weekly'), ROUTINE_CADENCE.WEEKLY)
  assert.equal(parseCadence('cron'), ROUTINE_CADENCE.DAILY)
  assert.equal(parseClock('8:05').minute, 5)
  assert.equal(parseClock('25:00'), null)
})

test('only daily and weekly rhythms are routines', () => {
  assert.equal(routineOf({ routine: { live: true } }), null)
  assert.equal(routineOf({ routine: { cadence: 'cron', enabled: true } }), null)
  assert.equal(routineOf({ routine: null }), null)
})

test('daily waits for today, then the next local morning', () => {
  const before = new Date(2026, 10, 19, 7, 30).getTime()
  assert.equal(nextRoutineAt({ cadence: 'daily', hour: 8 }, before), new Date(2026, 10, 19, 8, 0).getTime())
  const after = new Date(2026, 10, 19, 9, 0).getTime()
  assert.equal(nextRoutineAt({ cadence: 'daily', hour: 8 }, after), new Date(2026, 10, 20, 8, 0).getTime())
})

test('weekly lands on Monday morning', () => {
  const wednesday = new Date(2026, 10, 18, 9, 0).getTime()
  assert.equal(nextRoutineAt({ cadence: 'weekly', hour: 8 }, wednesday), new Date(2026, 10, 23, 8, 0).getTime())
})

test('a run that just finished does not immediately trigger again', () => {
  const at = new Date(2026, 10, 19, 7, 50).getTime()
  assert.equal(nextRoutineAt({ cadence: 'daily', hour: 8 }, at), new Date(2026, 10, 20, 8, 0).getTime())
})

test('enabling after today’s slot catches up now; before it waits', () => {
  const early = new Date(2026, 10, 19, 7, 0).getTime()
  assert.equal(catchUpRoutineAt({ cadence: 'daily', hour: 8 }, early), new Date(2026, 10, 19, 8, 0).getTime())
  const late = new Date(2026, 10, 19, 10, 0).getTime()
  assert.equal(catchUpRoutineAt({ cadence: 'daily', hour: 8 }, late), late)
  const soon = new Date(2026, 10, 19, 7, 55).getTime()
  assert.equal(catchUpRoutineAt({ cadence: 'daily', hour: 8 }, soon), new Date(2026, 10, 19, 8, 0).getTime())
})

test('a late catch-up waits for today when today’s slot is still ahead', () => {
  const daily = { cadence: 'daily', hour: 8, minute: 0 }
  assert.equal(routineDueNow(daily, new Date(2026, 10, 19, 7, 0).getTime()), false)
  assert.equal(routineDueNow(daily, new Date(2026, 10, 19, 10, 0).getTime()), true)
  const weekly = { cadence: 'weekly', hour: 8, minute: 0 }
  const mondayEarly = new Date(2026, 10, 23, 7, 0).getTime()
  assert.equal(routineDueNow(weekly, mondayEarly), false)
  assert.equal(routineDueNow(weekly, new Date(2026, 10, 24, 9, 0).getTime()), true)
})

test('schedule and moment labels speak in human time', () => {
  assert.equal(scheduleLabelOf({ cadence: 'daily', hour: 8, minute: 0 }), '每天早上 8:00')
  assert.equal(scheduleLabelOf({ cadence: 'weekly', hour: 8, minute: 0 }), '每周一早上 8:00')
  const now = new Date(2026, 10, 19, 18, 0).getTime()
  const tomorrow = new Date(2026, 10, 20, 8, 0).getTime()
  assert.equal(routineNextLabel(tomorrow, now), '明早 8:00')
})

test('a room row says the next run or today’s finished result', () => {
  const now = new Date(2026, 10, 19, 18, 0).getTime()
  const room = routine => ({ routine: { cadence: 'daily', hour: 8, minute: 0, enabled: true, ...routine } })
  assert.equal(routineLineOf(room({ nextRunAt: new Date(2026, 10, 20, 8, 0).getTime() }), now), '下次 明早 8:00')
  assert.equal(routineLineOf(room({ lastFinishedAt: new Date(2026, 10, 19, 8, 12).getTime() }), now), '今天 8:12 做完了')
  assert.equal(routineLineOf(room({ enabled: false, paused: true }), now), '已经停下')
})
