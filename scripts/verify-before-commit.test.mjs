import assert from 'node:assert/strict'
import test from 'node:test'
import { isVcsWrite } from './verify-before-commit.mjs'

test('commit and push are gated, other shell commands are not', () => {
  assert.equal(isVcsWrite('git commit -m "save"'), true)
  assert.equal(isVcsWrite('cd repo && git commit -m "save"'), true)
  assert.equal(isVcsWrite('git -C /tmp/repo push'), true)
  assert.equal(isVcsWrite('git -c user.name=x commit'), true)
  assert.equal(isVcsWrite('git status'), false)
  assert.equal(isVcsWrite('echo "git commit"'), false)
  assert.equal(isVcsWrite('npm test'), false)
})
