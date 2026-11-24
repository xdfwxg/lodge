import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_PROMISE_SCHEDULE,
  nextPromiseRunAt,
  normalizePromiseSchedule,
  promiseScheduleError,
  promiseScheduleText,
} from './promise.js'

const at = (year, month, day, hour, minute = 0) => new Date(year, month - 1, day, hour, minute, 0, 0).getTime()

test('a weekly promise moves to the next matching weekday', () => {
  const from = at(2026, 11, 23, 9) // Monday
  assert.equal(nextPromiseRunAt({ every: 'week', weekday: 5, at: '18:00' }, from), at(2026, 11, 27, 18))
})

test('a weekly promise that already passed waits a whole week', () => {
  const from = at(2026, 11, 27, 19) // Friday after 18:00
  assert.equal(nextPromiseRunAt({ every: 'week', weekday: 5, at: '18:00' }, from), at(2026, 12, 4, 18))
})

test('a daily promise moves to tomorrow when today passed', () => {
  const from = at(2026, 11, 23, 9)
  assert.equal(nextPromiseRunAt({ every: 'day', at: '08:00' }, from), at(2026, 11, 24, 8))
})

test('the schedule text is the sentence people read', () => {
  assert.equal(promiseScheduleText({ every: 'week', weekday: 5, at: '18:00' }), '每周五 18:00')
  assert.equal(promiseScheduleText({ every: 'day', at: '08:00' }), '每天 08:00')
})

test('invalid schedule fields are rejected before they reach storage', () => {
  assert.equal(promiseScheduleError({ at: '8:00' }), '时间要写成 HH:MM')
  assert.equal(promiseScheduleError({ every: 'month' }), '只能每天或每周')
  assert.equal(promiseScheduleError({ every: 'week', weekday: 7, at: '18:00' }), '星期不对')
  assert.equal(promiseScheduleError({ every: 'week', weekday: 5, at: '18:00' }), '')
})

test('normalization falls back to the product default', () => {
  assert.deepEqual(normalizePromiseSchedule(null), { ...DEFAULT_PROMISE_SCHEDULE })
  assert.deepEqual(normalizePromiseSchedule({ every: 'day' }), { every: 'day', at: '18:00' })
})
