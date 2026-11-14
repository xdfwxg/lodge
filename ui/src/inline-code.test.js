import assert from 'node:assert/strict'
import test from 'node:test'
import { inlineCode } from './inline-code.js'

test('backticked spans become readable code elements', () => {
  const parts = inlineCode('运行 `npm test` 通过')
  assert.equal(parts.length, 3)
  assert.equal(parts[0], '运行 ')
  assert.equal(parts[1].type, 'code')
  assert.equal(parts[1].props.children, 'npm test')
  assert.equal(parts[2], ' 通过')
})

test('plain text and unclosed backticks stay as written', () => {
  assert.deepEqual(inlineCode('没有命令'), ['没有命令'])
  assert.deepEqual(inlineCode('半截 `npm test'), ['半截 `npm test'])
})
