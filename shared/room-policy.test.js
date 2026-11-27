import assert from 'node:assert/strict'
import test from 'node:test'
import { copyIssueOf } from './product-copy.js'
import {
  ROOM_POLICY_DEFAULTS,
  ROOM_POLICY_OPTIONS,
  approvalOf,
  networkModeOf,
  normalizeRoomPolicy,
  policyIsDefault,
  policySummaryOf,
  roomPolicyOf,
} from './room-policy.js'

test('a room without a policy reads the conservative default, not a second legacy definition', () => {
  assert.deepEqual(roomPolicyOf({ members: [] }), ROOM_POLICY_DEFAULTS)
})

test('a new room starts at the conservative default', () => {
  const { policy, error } = normalizeRoomPolicy(undefined)
  assert.equal(error, undefined)
  assert.deepEqual(policy, ROOM_POLICY_DEFAULTS)
  assert.equal(approvalOf(policy), 'ask')
  assert.equal(networkModeOf(policy), 'proxy')
  assert.equal(policyIsDefault(policy), true)
})

test('only declared values are accepted, and missing keys keep the current value', () => {
  assert.equal(normalizeRoomPolicy({ files: 'readonly' }).error, '权限设置不对')
  assert.equal(normalizeRoomPolicy({ network: 'open' }).error, '权限设置不对')
  assert.equal(normalizeRoomPolicy('yes').error, '权限设置不对')
  const { policy } = normalizeRoomPolicy({ network: 'model' }, { files: 'confirm', network: 'proxy', external: 'auto' })
  assert.deepEqual(policy, { files: 'confirm', network: 'model', external: 'auto' })
  assert.equal(networkModeOf(policy), 'model')
  assert.equal(approvalOf(policy), 'ask')
})

test('a partial policy falls back to the conservative default, not the old behaviour', () => {
  const policy = roomPolicyOf({ policy: { network: 'model' } })
  assert.equal(policy.external, 'ask')
  assert.equal(policy.files, 'direct')
})

test('every permission label passes the copy gate', () => {
  for (const options of Object.values(ROOM_POLICY_OPTIONS)) {
    for (const option of options) {
      assert.equal(copyIssueOf(option.label), null, option.label)
      assert.equal(copyIssueOf(option.short), null, option.short)
    }
  }
})

test('a room that asks about changes or external actions has to stop for a card', () => {
  assert.equal(approvalOf({ files: 'confirm', network: 'proxy', external: 'auto' }), 'ask')
  assert.equal(approvalOf({ files: 'direct', network: 'proxy', external: 'ask' }), 'ask')
  assert.equal(approvalOf({ files: 'direct', network: 'proxy', external: 'auto' }), 'auto')
  assert.equal(policySummaryOf({ files: 'confirm', network: 'model', external: 'ask' }), '每步先问 · 只连模型 · 外部动作先问')
})
