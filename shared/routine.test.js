import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ALL_DAYS,
  catchUpRoutineAt,
  daysLabelOf,
  nextRoutineAt,
  normalizeDays,
  parseClock,
  routineDueNow,
  routineLineOf,
  routineNextLabel,
  routineOf,
  scheduleLabelOf,
} from './routine.js'

test('a routine is a room property with chosen days and a clock', () => {
  assert.deepEqual(routineOf({ routine: { days: [5, 1, 3, 3], enabled: true, hour: 9, minute: 30 } }), {
    days: [1, 3, 5],
    hour: 9,
    minute: 30,
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
  assert.equal(routineOf({ routine: { enabled: true, hour: 8, minute: 0 } }), null)
  assert.deepEqual(normalizeDays([7, -1, 2, 2, 0]), [0, 2])
  assert.equal(parseClock('8:05').minute, 5)
  assert.equal(parseClock('25:00'), null)
})

test('a routine needs at least one real day', () => {
  assert.equal(routineOf({ routine: { live: true } }), null)
  assert.equal(routineOf({ routine: { days: [], enabled: true } }), null)
  assert.equal(routineOf({ routine: { days: [9], enabled: true } }), null)
  assert.equal(routineOf({ routine: null }), null)
})

test('every day waits for today, then the next local morning', () => {
  const before = new Date(2026, 10, 19, 7, 30).getTime()
  assert.equal(nextRoutineAt({ days: ALL_DAYS, hour: 8 }, before), new Date(2026, 10, 19, 8, 0).getTime())
  const after = new Date(2026, 10, 19, 9, 0).getTime()
  assert.equal(nextRoutineAt({ days: ALL_DAYS, hour: 8 }, after), new Date(2026, 10, 20, 8, 0).getTime())
})

test('only the chosen days come around', () => {
  const mondayWednesdayFriday = [1, 3, 5]
  const thursday = new Date(2026, 10, 19, 9, 0).getTime()
  assert.equal(nextRoutineAt({ days: mondayWednesdayFriday, hour: 8 }, thursday), new Date(2026, 10, 20, 8, 0).getTime())
  const wednesdayEarly = new Date(2026, 10, 18, 7, 0).getTime()
  assert.equal(nextRoutineAt({ days: mondayWednesdayFriday, hour: 8 }, wednesdayEarly), new Date(2026, 10, 18, 8, 0).getTime())
  const wednesdayLate = new Date(2026, 10, 18, 9, 0).getTime()
  assert.equal(nextRoutineAt({ days: [1], hour: 8 }, wednesdayLate), new Date(2026, 10, 23, 8, 0).getTime())
})

test('a run that just finished does not immediately trigger again', () => {
  const at = new Date(2026, 10, 19, 7, 50).getTime()
  assert.equal(nextRoutineAt({ days: ALL_DAYS, hour: 8 }, at), new Date(2026, 10, 20, 8, 0).getTime())
})

test('enabling after today’s slot catches up now; before it waits', () => {
  const early = new Date(2026, 10, 19, 7, 0).getTime()
  assert.equal(catchUpRoutineAt({ days: ALL_DAYS, hour: 8 }, early), new Date(2026, 10, 19, 8, 0).getTime())
  const late = new Date(2026, 10, 19, 10, 0).getTime()
  assert.equal(catchUpRoutineAt({ days: ALL_DAYS, hour: 8 }, late), late)
  const soon = new Date(2026, 10, 19, 7, 55).getTime()
  assert.equal(catchUpRoutineAt({ days: ALL_DAYS, hour: 8 }, soon), new Date(2026, 10, 19, 8, 0).getTime())
})

test('a day that is not chosen has nothing to catch up', () => {
  const thursday = new Date(2026, 10, 19, 10, 0).getTime()
  assert.equal(catchUpRoutineAt({ days: [1], hour: 8 }, thursday), new Date(2026, 10, 23, 8, 0).getTime())
  assert.equal(routineDueNow({ days: [1], hour: 8, minute: 0 }, thursday), false)
})

test('a late catch-up waits for today when today’s slot is still ahead', () => {
  const everyDay = { days: ALL_DAYS, hour: 8, minute: 0 }
  assert.equal(routineDueNow(everyDay, new Date(2026, 10, 19, 7, 0).getTime()), false)
  assert.equal(routineDueNow(everyDay, new Date(2026, 10, 19, 10, 0).getTime()), true)
  const monday = { days: [1], hour: 8, minute: 0 }
  assert.equal(routineDueNow(monday, new Date(2026, 10, 23, 7, 0).getTime()), false)
  assert.equal(routineDueNow(monday, new Date(2026, 10, 23, 9, 0).getTime()), true)
})

test('schedule labels speak in human time', () => {
  assert.equal(scheduleLabelOf({ days: ALL_DAYS, hour: 8, minute: 0 }), '每天 8:00')
  assert.equal(scheduleLabelOf({ days: [1, 3], hour: 8, minute: 0 }), '周一、周三 8:00')
  assert.equal(scheduleLabelOf({ days: [1, 2, 3, 4, 5], hour: 9, minute: 30 }), '周一到周五 9:30')
  assert.equal(scheduleLabelOf({ days: [0, 6], hour: 10, minute: 0 }), '周六、周日 10:00')
  assert.equal(daysLabelOf([0, 1, 2, 4, 5, 6]), '除周三外每天')
  assert.equal(daysLabelOf([2, 4, 6]), '周二、周四、周六')
  const now = new Date(2026, 10, 19, 18, 0).getTime()
  const tomorrow = new Date(2026, 10, 20, 8, 0).getTime()
  assert.equal(routineNextLabel(tomorrow, now), '明早 8:00')
})

test('a room row says the next run or today’s finished result', () => {
  const now = new Date(2026, 10, 19, 18, 0).getTime()
  const room = routine => ({ routine: { days: ALL_DAYS, hour: 8, minute: 0, enabled: true, ...routine } })
  assert.equal(routineLineOf(room({ nextRunAt: new Date(2026, 10, 20, 8, 0).getTime() }), now), '下次 明早 8:00')
  assert.equal(routineLineOf(room({ lastFinishedAt: new Date(2026, 10, 19, 8, 12).getTime() }), now), '今天 8:12 做完了')
  assert.equal(routineLineOf(room({ enabled: false, paused: true }), now), '已经停下')
})
