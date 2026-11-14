import assert from 'node:assert/strict'
import test from 'node:test'
import { roomLabelOf } from './sidebar.js'

test('sidebar room labels carry name, status, unread and needs-you text', () => {
  assert.equal(roomLabelOf({ name: '简历', state: 'active', live: true }), '简历，实时')
  assert.equal(
    roomLabelOf({ name: '简历', state: 'active', needsYou: { kind: 'review', label: '待复核' }, chatUnread: true }),
    '简历，复核，有新消息，待复核',
  )
  assert.equal(roomLabelOf({ name: '周报', state: 'complete' }), '周报，完成')
  assert.equal(roomLabelOf({ name: '空房', state: 'paused' }), '空房')
})
