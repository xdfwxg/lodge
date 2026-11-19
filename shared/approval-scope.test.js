import assert from 'node:assert/strict'
import test from 'node:test'
import { APPROVAL_SCOPE, approvalScopeLabel, parseApprovalScope } from './approval-scope.js'

test('an approval has exactly three scopes and unknown values fail closed', () => {
  assert.equal(parseApprovalScope('once'), APPROVAL_SCOPE.ONCE)
  assert.equal(parseApprovalScope('room'), APPROVAL_SCOPE.ROOM)
  assert.equal(parseApprovalScope('device'), APPROVAL_SCOPE.DEVICE)
  assert.equal(parseApprovalScope('everything'), null)
  assert.equal(approvalScopeLabel('device'), '这台电脑都允许')
})
