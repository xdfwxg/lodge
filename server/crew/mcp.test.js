import assert from 'node:assert/strict'
import test from 'node:test'
import { mcpCalls } from './mcp.js'

test('mcp calls are grouped by server and tool from runtime tool summaries', () => {
  const calls = mcpCalls([
    { name: 'Bash', count: 3, failed: 1 },
    { name: 'mcp__github__search_issues', count: 2, failed: 1 },
    { name: 'mcp:github:search_issues', count: 1, failed: 0 },
    { name: 'mcp__github__create_issue', count: 1, failed: 0 },
  ])
  assert.deepEqual(calls, [
    { server: 'github', tool: 'search_issues', count: 3, failed: 1 },
    { server: 'github', tool: 'create_issue', count: 1, failed: 0 },
  ])
})

test('malformed mcp names are ignored rather than guessed', () => {
  assert.deepEqual(mcpCalls([{ name: 'mcp__', count: 1 }, { name: 'mcp:github', count: 2 }, null]).length, 0)
})
