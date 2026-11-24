import assert from 'node:assert/strict'
import test from 'node:test'
import { attentionDecision, clampBadge, roomsPayload } from './attention.mjs'

test('the badge is a whole number between 0 and 99', () => {
  assert.equal(clampBadge(3), 3)
  assert.equal(clampBadge(0), 0)
  assert.equal(clampBadge(-4), 0)
  assert.equal(clampBadge(120), 99)
  assert.equal(clampBadge(2.5), 0)
  assert.equal(clampBadge('4'), 0)
  assert.equal(clampBadge(undefined), 0)
})

test('the room menu takes at most nine real rooms, trimmed', () => {
  const rooms = Array.from({ length: 12 }, (_, index) => ({ id: `r${index}`, name: `N${index}` }))
  const payload = roomsPayload([...rooms, { id: 'bad' }, { name: 'bad' }, null])
  assert.equal(payload.length, 9)
  assert.deepEqual(payload[0], { id: 'r0', name: 'N0' })
  assert.equal(payload.at(-1).id, 'r8')

  const long = roomsPayload([{ id: 'x'.repeat(200), name: 'y'.repeat(200) }])
  assert.equal(long[0].id.length, 120)
  assert.equal(long[0].name.length, 80)
  assert.deepEqual(roomsPayload(null), [])
})

test('a notification is delivered only when the window is not in front', () => {
  const payload = { count: 2, notify: { roomId: 'r-1', title: 't', body: 'b' } }
  const shown = attentionDecision({ payload, supported: true, focused: false })
  assert.equal(shown.count, 2)
  assert.deepEqual(shown.notify, { roomId: 'r-1', title: 't', body: 'b' })

  assert.equal(attentionDecision({ payload, supported: true, focused: true }).notify, null)
  assert.equal(attentionDecision({ payload, supported: false, focused: false }).notify, null)
  assert.equal(attentionDecision({ payload: { count: 1 }, supported: true, focused: false }).notify, null)
  assert.equal(attentionDecision({
    payload: { count: 1, notify: { roomId: 3, title: 't', body: 'b' } },
    supported: true,
    focused: false,
  }).notify, null)
})

test('notification text is clipped before the OS sees it', () => {
  const decision = attentionDecision({
    payload: {
      count: 0,
      notify: { roomId: 'r-1', title: 't'.repeat(500), body: 'b'.repeat(500) },
    },
    supported: true,
    focused: false,
  })
  assert.equal(decision.notify.title.length, 120)
  assert.equal(decision.notify.body.length, 240)
})
