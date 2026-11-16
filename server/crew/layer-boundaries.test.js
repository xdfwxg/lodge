import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

const applicationFiles = [
  'rooms/create/create.js',
  'rooms/create/input.js',
  'rooms/studio/start.js',
  'rooms/create/record.js',
  'rooms/create/workspace.js',
  'rooms/create/provision.js',
  'rooms/studio/complete.js',
  'service.js',
  'service-queries.js',
  'rooms/studio/service-stages.js',
  'rooms/studio/service-closure.js',
  'rooms/base/live.js',
  'rooms/kinds.js',
  'rooms/chat/runtime.js',
  'rooms/chat/kind.js',
  'rooms/chat/facade.js',
  'rooms/chat/projection.js',
  'rooms/chat/scheduler.js',
  'rooms/chat/service.js',
  'rooms/studio/runtime.js',
  'rooms/studio/kind.js',
  'rooms/studio/prompts.js',
  'kernel/live/bus.js',
  'kernel/live/projection.js',
  'kernel/live/refresh.js',
  'kernel/live/approvals.js',
  'kernel/live/sync.js',
  'rooms/studio/turns.js',
  'rooms/studio/acceptance-runner.js',
  'rooms/studio/integration.js',
  'rooms/studio/review.js',
  'rooms/studio/stage.js',
  'rooms/studio/turn-state.js',
  'rooms/studio/workspace.js',
  'rooms/studio/delivery.js',
  'rooms/studio/gates.js',
  'rooms/studio/verifiers.js',
  'rooms/studio/stage-plan.js',
  'rooms/studio/tasks.js',
  'rooms/studio/progress.js',
  'rooms/studio/seat-handoff.js',
  'workspace-gc.js',
  'presentation.js',
]

const forbiddenDependencies = [
  'crew-ports.js',
  'store.js',
  'engine.js',
  'base.js',
  'room-repo.js',
  'seat-env.js',
  'paths.js',
  'project.js',
  'template-store.js',
  'room-template-store.js',
  'skill-store.js',
  'acceptance.js',
  'sandbox.js',
  'lock.js',
  'workspace-git.js',
  'workspace-direct.js',
  'workspace-plain.js',
  'system-open.js',
  'system-dialog.js',
]

const walk = dir => readdirSync(join(root, dir)).flatMap(name => {
  const path = join(dir, name)
  return statSync(join(root, path)).isDirectory() ? walk(path) : [path]
})

test('the chat kernel never depends on a concrete room engine', () => {
  for (const file of walk('kernel')) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(text, /from\s+['"][^'"]*rooms\/(chat|studio)\//, `${file} imports a concrete room engine`)
  }
})

test('room engines never import each other', () => {
  for (const file of walk('rooms/chat')) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /from\s+['"][^'"]*rooms\/studio\//, `${file} imports the studio engine`)
  }
  for (const file of walk('rooms/studio')) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    assert.doesNotMatch(readFileSync(join(root, file), 'utf8'), /from\s+['"][^'"]*rooms\/chat\//, `${file} imports the chat engine`)
  }
})

test('application modules depend on ports, not concrete adapters', () => {
  for (const file of applicationFiles) {
    const text = readFileSync(join(root, file), 'utf8')
    for (const dependency of forbiddenDependencies) {
      const pattern = new RegExp(`from\\s+['"](?:\\.{1,2}/)*${dependency.replaceAll('.', '\\.')}['"]`)
      assert.doesNotMatch(text, pattern, `${file} imports concrete dependency ${dependency}`)
    }
    assert.doesNotMatch(text, /from\s+['"]node:fs['"]/, `${file} imports node:fs directly`)
  }
})

test('business files never resolve base names or addresses', () => {
  const businessFiles = [
    'rooms/studio/handoff.js',
    'rooms/studio/prompts.js',
    'rooms/studio/start.js',
    'rooms/studio/review.js',
    'rooms/studio/stage.js',
    'rooms/studio/turns.js',
    'rooms/chat/scheduler.js',
  ]
  for (const file of businessFiles) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(
      text,
      /seatBaseName|seatAddress|hostAddress|toBaseMentions|toDisplayMentions/,
      `${file} resolves a base address instead of naming a seat`,
    )
  }
})

test('prompt builders do not send messages', () => {
  const text = readFileSync(join(root, 'rooms/studio/prompts.js'), 'utf8')
  assert.doesNotMatch(text, /sendTurn|engine\./, 'prompts.js both builds prompts and delivers them')
})
