import assert from 'node:assert/strict'
import test from 'node:test'
import { bodyChangeBlocker } from './body-change.js'

const room = overrides => ({
  state: 'active',
  busy: false,
  turnQueue: [],
  pauseReason: null,
  ...overrides,
})

test('body changes wait for a busy or speaking room', () => {
  assert.match(bodyChangeBlocker(room({ busyMembers: ['worker'] }), '换身体'), /等手上这次做完/)
  assert.match(bodyChangeBlocker(room({ roomType: 'chat', chat: { running: true } }), '移除成员'), /等手上这次做完/)
  assert.match(bodyChangeBlocker(room({ turnQueue: [{ state: 'queued' }] }), '加成员'), /等手上这次做完/)
  assert.equal(bodyChangeBlocker(room({}), '换身体'), null)
})

test('archived, stopped, offline or approval-paused rooms refuse body changes', () => {
  assert.match(bodyChangeBlocker(room({ archivedAt: 1 }), '换身体'), /已归档/)
  assert.match(bodyChangeBlocker(room({ state: 'stopped' }), '换身体'), /已停止/)
  assert.match(bodyChangeBlocker(room({ connectionError: 'x' }), '移除成员'), /连接中断/)
  assert.match(bodyChangeBlocker(room({ pauseReason: 'approval' }), '加成员'), /待确认/)
})
