import assert from 'node:assert/strict'
import test from 'node:test'
import { renderRetro, retroOf } from './env-retro.mjs'

test('a source change without tests is the first environment warning', () => {
  const items = retroOf({ changedFiles: ['server/crew/body.js'] })
  assert.equal(items[0].severity, 'high')
  assert.match(items[0].title, /没有测试改动/)
  assert.match(renderRetro(items), /environment retro/)
})

test('a clean change has no warnings', () => {
  const items = retroOf({
    changedFiles: ['server/crew/body.js', 'server/crew/body.test.js', 'docs/architecture.md'],
  })
  assert.deepEqual(items, [])
  assert.match(renderRetro(items), /没有明显缺口/)
})

test('mechanical diff errors become checks', () => {
  const items = retroOf({ changedFiles: ['README.md'], diffCheck: 'trailing whitespace' })
  assert.equal(items[0].severity, 'high')
  assert.match(items[0].fix, /git diff --check/)
})
