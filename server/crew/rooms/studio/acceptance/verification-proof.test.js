import assert from 'node:assert/strict'
import test from 'node:test'
import { verificationProofOf } from './verification-proof.js'

test('running a check counts as hands-on verification', () => {
  const proof = verificationProofOf([{ name: 'Bash', step: { target: 'npm test' } }])
  assert.equal(proof.ok, true)
  assert.equal(proof.kind, 'exec')
})

test('reading a changed file counts, reading an unrelated file does not', () => {
  const changedFiles = ['src/export.js', 'README.md']
  assert.equal(verificationProofOf([
    { name: 'Read', step: { target: 'src/export.js' } },
  ], { changedFiles }).ok, true)
  assert.equal(verificationProofOf([
    { name: 'Read', step: { target: '/tmp/worktree/README.md' } },
  ], { changedFiles }).ok, true)
  assert.equal(verificationProofOf([
    { name: 'Read', step: { target: 'node_modules/pkg/index.js' } },
  ], { changedFiles }).ok, false)
})

test('the verdict tool itself is not proof of verification', () => {
  assert.equal(verificationProofOf([
    { name: 'mcp__lodge_gate__submit_verdict', step: { target: 'covered' } },
  ], { changedFiles: ['src/export.js'] }).ok, false)
})

test('with no changed files, only running a check counts', () => {
  assert.equal(verificationProofOf([{ name: 'Read', step: { target: 'README.md' } }]).ok, false)
  assert.equal(verificationProofOf([{ name: 'Bash', step: { target: 'npm test' } }]).ok, true)
})

test('every package proof must be rerun, not just the first', () => {
  const calls = [{ name: 'Bash', step: { target: 'node --test test/a.test.js' } }]
  const missing = verificationProofOf(calls, { requiredEntries: ['node --test test/a.test.js', 'node --test test/b.test.js'] })
  assert.equal(missing.ok, false)
  assert.deepEqual(missing.missing, ['node --test test/b.test.js'])
  const done = verificationProofOf([
    ...calls,
    { name: 'Bash', step: { target: 'node --test test/b.test.js' } },
  ], { requiredEntries: ['node --test test/a.test.js', 'node --test test/b.test.js'] })
  assert.equal(done.ok, true)
  assert.equal(done.kind, 'proof')
})

test('a tool call whose input is a JSON string still counts as a rerun', () => {
  const entry = "test -f hello.txt && grep -qx 'hello lodge' hello.txt"
  const call = {
    name: 'bash',
    input: JSON.stringify({ command: `cd /tmp/revv && ${entry}` }),
  }
  const proof = verificationProofOf([call], { requiredEntries: [entry] })
  assert.equal(proof.ok, true, '基座的活动消息把入参当字符串交上来，也要能对上')
})

test('the same command wrapped in a subshell still counts as a rerun', () => {
  // 真房现场：验收员把证明入口包在 `cd … && echo … && ( … )` 里重跑，
  // 逐段相等因为一个左括号判成“没重跑”，把一次真的复核否掉了。
  const entry = 'test -f hello.txt && test "$(cat hello.txt)" = "hello lodge" && node tools/check.mjs'
  const proof = verificationProofOf([{
    name: 'bash',
    input: JSON.stringify({
      command: `cd /tmp/rev && echo "== entry ==" && ( ${entry} ); echo "exit=$?"`,
    }),
  }], { requiredEntries: [entry] })
  assert.equal(proof.ok, true)
})

test('mentioning the command without running it is not a rerun', () => {
  const entry = 'node --test test/a.test.js'
  const proof = verificationProofOf([
    { name: 'bash', input: JSON.stringify({ command: `echo ${entry}` }) },
  ], { requiredEntries: [entry] })
  assert.equal(proof.ok, false)
})
