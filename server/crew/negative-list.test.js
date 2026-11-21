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

test('chat modules do not read studio stages, evidence or verdict state', () => {
  for (const file of ['rooms/chat/runtime.js', 'rooms/chat/scheduler.js', 'rooms/chat/service.js', 'room-types/chat.js']) {
    const source = read(file)
    assert.doesNotMatch(source, /\broom\??\.(stages|evidence|verdict|trust)\b/, `${file} reads studio state`)
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
    'rooms/studio/complete.js',
    'rooms/studio/service-stages.js',
    'rooms/studio/verifiers.js',
    'rooms/studio/stage-plan.js',
    'rooms/studio/progress.js',
    'rooms/studio/member-handoff.js',
    'room-types/studio.js',
  ]) {
    const source = read(file)
    assert.doesNotMatch(source, /\broom\??\.chat\b/, `${file} reads room.chat`)
  }
})

test('chat and studio capability flags stay separated', async () => {
  const { capabilitiesFor } = await import('./rooms/kinds.js')
  assert.equal(capabilitiesFor('chat').stages, false)
  assert.equal(capabilitiesFor('chat').piExecution, false)
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

test('shared crew modules reach modes only through kinds, facades or assembly points', () => {
  const allowed = /(?:^|\/)rooms\/kinds\.js$|(?:^|\/)rooms\/(?:chat|studio)\/facade\.js$/
  // service.js 分发各模式用例，rooms/base/live.js 装配各模式运行时；它们是组合点，不是共享业务。
  const assembly = new Set(['service.js', 'rooms/base/live.js'])
  for (const file of sources('.')) {
    if (file.name.startsWith('rooms/chat/') || file.name.startsWith('rooms/studio/')) continue
    if (assembly.has(file.name)) continue
    for (const match of file.text.matchAll(/from ['"]([^'"]+)['"]/g)) {
      if (!match[1].includes('rooms/')) continue
      assert.match(match[1], allowed, `${file.name} imports ${match[1]} instead of a facade`)
    }
  }
})

test('static discipline lives in member souls, not per-turn prompts', () => {
  for (const file of [
    'rooms/studio/prompts.js',
    'rooms/studio/review.js',
    'rooms/studio/stage.js',
    'rooms/create/input.js',
  ]) {
    assert.doesNotMatch(read(file), /workContract|modeGuidance/, `${file} repeats static discipline`)
  }
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
    'service-queries.js',
    'rooms/create/create.js',
    'rooms/create/input.js',
    'rooms/create/record.js',
    'rooms/create/provision.js',
    ]
  for (const file of kernel) {
    const text = read(file)
    for (const field of ['chat', 'chatHost', 'stages']) {
      assert.doesNotMatch(
        text,
        new RegExp(`(?<!['"])\\b(?:room|parentRoom|current)\\??\\.${field}\\b`),
        `${file} reads ${field} directly instead of using a facade`,
      )
    }
  }
})


test('member rules never branch on what the task is about', () => {
  // 纪律来自角色、房型和能力，不来自任务关键词；否则每个新任务都要换一份提示词。
  const files = [
    'prompt-modes.js',
    'rooms/chat/kind.js',
    'rooms/chat/scheduler.js',
    'rooms/studio/kind.js',
    'rooms/studio/prompts.js',
    'rooms/studio/review.js',
    'rooms/create/input.js',
    'roster-recommend.js',
    'member-delivery.js',
  ]
  for (const file of files) {
    const source = read(file)
    assert.doesNotMatch(
      source,
      /\bgoal\s*\.\s*(?:includes|match|startsWith|endsWith)\s*\(/,
      `${file} branches member rules on goal text`,
    )
  }
})

test('generic room creation knows no room engine handoff', () => {
  for (const file of sources('rooms/create')) {
    assert.doesNotMatch(
      file.text,
      /from ['"][^'"]*assignments\.js['"]/,
      `${file.name} imports assignments into generic creation`,
    )
    assert.doesNotMatch(
      file.text,
      /\b(?:parentRoom|room|current)\??\.stages\b/,
      `${file.name} reads a room engine's stage state`,
    )
  }
})
