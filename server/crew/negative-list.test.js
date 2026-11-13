import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const read = name => readFileSync(fileURLToPath(new URL(`./${name}`, import.meta.url)), 'utf8')

test('chat modules do not read studio closure, stages, evidence or verdict state', () => {
  for (const file of ['live-chat-room.js', 'service-chat.js', 'room-types/chat.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\broom\??\.(stages|closure|evidence|verdict|trust)\b/, `${file} reads studio state`)
  }
})

test('studio modules do not read room.chat', () => {
  for (const file of ['live-studio.js', 'live-stage.js', 'live-review.js', 'live-turns.js', 'room-types/studio.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\broom\??\.chat\b/, `${file} reads room.chat`)
  }
})

test('advisor advice code has no pass/verdict authority', () => {
  for (const file of ['advisor.js', 'room-gate.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\bpass\s*:/, `${file} writes a pass field`)
    assert.doesNotMatch(source, /\breject\s*:/, `${file} writes a reject field`)
    assert.doesNotMatch(source, /\bverdict\s*:/, `${file} writes a verdict field`)
  }
})

test('chat and studio capability flags stay separated', async () => {
  const { capabilitiesFor } = await import('./room-capabilities.js')
  assert.equal(capabilitiesFor('chat').stages, false)
  assert.equal(capabilitiesFor('chat').closure, false)
  assert.equal(capabilitiesFor('chat').piExecution, false)
  assert.equal(capabilitiesFor('studio').closure, true)
  assert.equal(capabilitiesFor('studio').verdict, true)
})

test('a subroom cannot rewrite the parent closure', () => {
  for (const file of ['service-subrooms.js', 'room-subrooms.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\bparent\??\.closure\s*=/, `${file} writes parent.closure`)
    assert.doesNotMatch(source, /\bcurrent\.closure\s*=/, `${file} writes current.closure`)
  }
})
