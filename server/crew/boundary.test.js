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
