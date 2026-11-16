import assert from 'node:assert/strict'
import test from 'node:test'
import { bodyChangeBlocker } from './body-change.js'

const room = overrides => ({
  state: 'active',
  busy: false,
  presence: [],
  turnQueue: [],
  pauseReason: null,
  ...overrides,
})

test('body changes wait for a busy or speaking room', () => {
  assert.match(bodyChangeBlocker(room({ busy: true }), '换身体'), /等这一回合结束/)
  assert.match(bodyChangeBlocker(room({ chat: { running: true } }), '移除成员'), /等这一回合结束/)
  assert.match(bodyChangeBlocker(room({ presence: [{ state: 'working' }] }), '加成员'), /等这一回合结束/)
  assert.equal(bodyChangeBlocker(room({}), '换身体'), null)
})

test('ended, offline or approval-paused rooms refuse body changes', () => {
  assert.match(bodyChangeBlocker(room({ state: 'complete' }), '换身体'), /已经结束/)
  assert.match(bodyChangeBlocker(room({ connectionError: 'x' }), '移除成员'), /连接中断/)
  assert.match(bodyChangeBlocker(room({ pauseReason: 'approval' }), '加成员'), /待确认/)
})
