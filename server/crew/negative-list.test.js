import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const dir = fileURLToPath(new URL('.', import.meta.url))
const read = name => readFileSync(join(dir, name), 'utf8')
const walk = folder => readdirSync(folder).flatMap(name => {
  const path = join(folder, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})
const sources = folder => walk(join(dir, folder))
  .filter(path => path.endsWith('.js') && !path.endsWith('.test.js'))
  .map(path => ({ name: relative(dir, path), text: readFileSync(path, 'utf8') }))

test('chat modules do not read studio closure, stages, evidence or verdict state', () => {
  for (const file of ['rooms/chat/runtime.js', 'rooms/chat/scheduler.js', 'rooms/chat/service.js', 'room-types/chat.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\broom\??\.(stages|closure|evidence|verdict|trust)\b/, `${file} reads studio state`)
  }
})

test('studio modules do not read room.chat', () => {
  for (const file of [
    'rooms/studio/runtime.js',
    'rooms/studio/prompts.js',
    'rooms/studio/stage.js',
    'rooms/studio/review.js',
    'rooms/studio/turns.js',
    'rooms/studio/delivery.js',
    'rooms/studio/gates.js',
    'rooms/studio/review-report.js',
    'rooms/studio/complete.js',
    'rooms/studio/repair.js',
    'rooms/studio/service-stages.js',
    'rooms/studio/service-closure.js',
    'rooms/studio/service-trust.js',
    'rooms/studio/trust.js',
    'rooms/studio/service-subrooms.js',
    'rooms/studio/subrooms.js',
    'rooms/studio/verifiers.js',
    'rooms/studio/stage-plan.js',
    'rooms/studio/tasks.js',
    'rooms/studio/progress.js',
    'rooms/studio/seat-handoff.js',
    'rooms/studio/handoff.js',
    'rooms/studio/demo.js',
    'rooms/studio/gate.js',
    'room-types/studio.js',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /\broom\??\.chat\b/, `${file} reads room.chat`)
  }
})

test('shared trust policy does not depend on a room mode', () => {
  assert.doesNotMatch(read('trust.js'), /from\s+['"][^'"]*rooms\//)
})

test('advisor advice code has no pass/verdict authority', () => {
  for (const file of ['advisor.js', 'rooms/studio/gate.js']) {
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

test('chat and studio contexts never import each other', () => {
  for (const file of sources('rooms/chat')) {
    assert.doesNotMatch(file.text, /from ['"][^'"]*rooms\/studio\//, `${file.name} imports the studio context`)
  }
  for (const file of sources('rooms/studio')) {
    assert.doesNotMatch(file.text, /from ['"][^'"]*rooms\/chat\//, `${file.name} imports the chat context`)
  }
})

test('kernel and creation units reach contexts only through kinds or facades', () => {
  const allowed = /(?:^|\/)rooms\/kinds\.js$|(?:^|\/)rooms\/(?:chat|studio)\/facade\.js$|^\.\.\/kinds\.js$/
  for (const file of [...sources('kernel/live'), ...sources('rooms/create')]) {
    for (const match of file.text.matchAll(/from ['"]([^'"]+)['"]/g)) {
      if (!match[1].includes('rooms/')) continue
      assert.match(match[1], allowed, `${file.name} imports ${match[1]} instead of a facade`)
    }
  }
})

test('static discipline lives in seat souls, not per-turn prompts', () => {
  for (const file of [
    'rooms/studio/prompts.js',
    'rooms/studio/review.js',
    'rooms/studio/stage.js',
    'rooms/create/input.js',
  ]) {
    assert.doesNotMatch(read(file), /workContract|modeGuidance/, `${file} repeats static discipline`)
  }
})

test('adding a seat reuses the room mode soul', () => {
  assert.match(read('service-seat-add.js'), /seatSoul/, 'seat added later skips the mode soul')
})

test('the shared state-machine mechanism knows no room mode', () => {
  const text = read('room-state.js')
  assert.doesNotMatch(text, /\b(chat|studio)\b/i, 'room-state.js hardcodes a mode')
  assert.doesNotMatch(text, /closure|stages/, 'room-state.js hardcodes mode state')
})

test('kernel modules read context state only through facades or kinds', () => {
  const kernel = [
    'kernel/live/bus.js',
    'kernel/live/projection.js',
    'kernel/live/refresh.js',
    'kernel/live/sync.js',
    'kernel/live/approvals.js',
    'attention.js',
    'presentation.js',
    'resources.js',
    'service-queries.js',
    'rooms/create/create.js',
    'rooms/create/input.js',
    'rooms/create/record.js',
    'rooms/create/provision.js',
    'service-seat-add.js',
  ]
  for (const file of kernel) {
    const text = read(file)
    for (const field of ['chat', 'chatHost', 'stages', 'closure']) {
      assert.doesNotMatch(
        text,
        new RegExp(`(?<!['"])\\b(?:room|current)\\??\\.${field}\\b`),
        `${file} reads ${field} directly instead of using a facade`,
      )
    }
  }
})

test('a subroom cannot rewrite the parent closure', () => {
  for (const file of ['rooms/studio/service-subrooms.js', 'rooms/studio/subrooms.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\bparent\??\.closure\s*=/, `${file} writes parent.closure`)
    assert.doesNotMatch(source, /\bcurrent\.closure\s*=/, `${file} writes current.closure`)
  }
})
