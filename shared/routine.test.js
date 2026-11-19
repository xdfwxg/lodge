import assert from 'node:assert/strict'
import test from 'node:test'
import { ROUTINE_TRIGGER, parseRoutineTrigger, routineOf } from './routine.js'

test('the one supported routine trigger is opening the app', () => {
  assert.equal(parseRoutineTrigger('on-open'), ROUTINE_TRIGGER.ON_OPEN)
  assert.equal(parseRoutineTrigger('every-minute'), null)
  assert.deepEqual(routineOf({ routine: { trigger: 'on-open', enabled: true, lastRunAt: 3 } }), {
    trigger: ROUTINE_TRIGGER.ON_OPEN,
    enabled: true,
    updatedAt: null,
    lastRunAt: 3,
    lastRoomId: null,
  })
})

test('unknown or malformed routines are ignored, not guessed', () => {
  assert.equal(routineOf({ routine: { trigger: 'cron', enabled: true } }), null)
  assert.equal(routineOf({ routine: null }), null)
})
