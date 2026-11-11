import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const dir = fileURLToPath(new URL('.', import.meta.url))
const sourceFiles = readdirSync(dir).filter(name => name.endsWith('.js') && !name.endsWith('.test.js'))

const forbidden = [
  ['a base-client import', /from ['"]\.\.\/base\.js['"]/],
  ['an engine import', /from ['"]\.\.\/engine\.js['"]/],
  ['HTTP transport', /from ['"]node:http['"]/],
  ['the base client type', /createBaseClient/],
  ['the upstream name', /openmausbot/i],
  ['defaultResponder', /defaultResponder/],
  ['memberIds', /memberIds/],
  ['botId / botName', /\bbotId\b|\bbotName\b/],
  ['a bare bot/group variable', /\bbot\b|\bgroup\b/],
  ['a groupId field', /\bgroupId\b/],
  ['approvalMode', /approvalMode/],
  ['mcpServers', /mcpServers/],
  ['threadId', /threadId/],
]

test('crew stays on the semantic side of the engine port', () => {
  for (const file of sourceFiles) {
    const text = readFileSync(join(dir, file), 'utf8')
    for (const [label, pattern] of forbidden) {
      assert.doesNotMatch(text, pattern, `${file} leaks ${label}`)
    }
  }
})

test('git stays inside the workspace provider', () => {
  // paths.js 只用 git 探测默认项目根；交付操作全部在 workspace-git.js。
  const allowed = new Set(['paths.js', 'workspace-git.js'])
  const pattern = /execFileSync\(['"]git['"]|execFile\(['"]git['"]|spawn\(['"]git['"]/
  for (const file of sourceFiles) {
    if (allowed.has(file)) continue
    assert.doesNotMatch(readFileSync(join(dir, file), 'utf8'), pattern, `${file} calls git directly`)
  }
})
