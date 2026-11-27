import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeBodySpec } from './body-spec.js'

test('body spec falls back to the current body when nothing is submitted', () => {
  const { spec } = normalizeBodySpec({
    fallback: { prompt: '你是执行官', skills: ['review'], mcp: [{ server: 'docs', approval: 'ask' }] },
  })
  assert.equal(spec.prompt, '你是执行官')
  assert.deepEqual(spec.skills, ['review'])
  assert.deepEqual(spec.mcp, [{ server: 'docs', approval: 'ask' }])
})

test('body spec trims prompt and accepts bare MCP names as read-only grants', () => {
  const { spec } = normalizeBodySpec({ input: { prompt: '  按步骤做  ', skills: [' a ', 'b'], mcp: ['docs'] } })
  assert.equal(spec.prompt, '按步骤做')
  assert.deepEqual(spec.skills, ['a', 'b'])
  assert.deepEqual(spec.mcp, [{ server: 'docs', approval: 'ask' }])
})

test('body spec rejects unsafe skill names and MCP grants', () => {
  assert.match(normalizeBodySpec({ input: { skills: ['rm -rf'] } }).error, /技能名/)
  assert.match(normalizeBodySpec({ input: { mcp: ['https://example.com'] } }).error, /工具连接只填名字/)
})
