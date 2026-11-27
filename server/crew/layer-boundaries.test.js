import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

const applicationFiles = [
  'rooms/create/create.js',
  'rooms/create/input.js',
  'rooms/studio/plan/start.js',
  'rooms/create/record.js',
  'rooms/create/workspace.js',
  'rooms/create/provision.js',
  'rooms/studio/plan/complete.js',
  'service.js',
  'service-queries.js',
  'rooms/studio/plan/service-stages.js',
  'rooms/live/live.js',
  'rooms/kinds.js',
  'rooms/chat/runtime.js',
  'rooms/chat/kind.js',
  'rooms/chat/facade.js',
  'rooms/chat/projection.js',
  'rooms/chat/scheduler.js',
  'rooms/chat/service.js',
  'rooms/studio/runtime/runtime.js',
  'rooms/studio/runtime/kind.js',
  'rooms/studio/runtime/prompts.js',
  'kernel/live/bus.js',
  'kernel/live/projection.js',
  'kernel/live/refresh.js',
  'kernel/live/approvals.js',
  'kernel/live/sync.js',
  'rooms/studio/runtime/turns.js',
  'rooms/studio/runtime/result.js',
  'rooms/studio/delivery/integration.js',
  'rooms/studio/acceptance/review.js',
  'rooms/studio/plan/stage.js',
  'rooms/studio/plan/turn-state.js',
  'rooms/studio/runtime/workspace.js',
  'rooms/studio/delivery/delivery.js',
  'rooms/studio/acceptance/gates.js',
  'rooms/studio/acceptance/verifiers.js',
  'rooms/studio/plan/stage-plan.js',
  'rooms/studio/plan/progress.js',
  'rooms/studio/delivery/member-handoff.js',
  'rooms/studio/delivery/human-handoff.js',
  'workspace-gc.js',
  'presentation.js',
]

const forbiddenDependencies = [
  'crew-ports.js',
  'store.js',
  'engine.js',
  'base.js',
  'room-repo.js',
  'member-env.js',
  'paths.js',
  'project.js',
  'template-store.js',
  'room-template-store.js',
  'skill-store.js',
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

test('the chat host stays inside the chat room', () => {
  for (const file of walk('rooms/studio')) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    assert.doesNotMatch(
      readFileSync(join(root, file), 'utf8'),
      /chatHost|hostLabel/,
      `${file} reaches into the chat host`,
    )
  }
})

test('business files never resolve base names or addresses', () => {
  const businessFiles = [
    'rooms/studio/delivery/handoff.js',
    'rooms/studio/runtime/prompts.js',
    'rooms/studio/plan/start.js',
    'rooms/studio/acceptance/review.js',
    'rooms/studio/plan/stage.js',
    'rooms/studio/runtime/turns.js',
    'rooms/chat/scheduler.js',
  ]
  for (const file of businessFiles) {
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(
      text,
      /memberSurfaceName|memberAddress|hostAddress|toBaseMentions|toDisplayMentions/,
      `${file} resolves a base address instead of naming a member`,
    )
  }
})

test('the chat scheduler depends on the transport port, not runtime history', () => {
  const text = readFileSync(join(root, 'rooms/chat/scheduler.js'), 'utf8')
  assert.doesNotMatch(text, /engine\.|sessionRef|authorRef|chatRoom|chatHost|body\?\.ref/)
  assert.match(text, /transport\./)
})

test('chat host provisioning stays behind ports', () => {
  const kind = readFileSync(join(root, 'rooms/chat/kind.js'), 'utf8')
  assert.doesNotMatch(kind, /engine\.|createMemberBot|deleteMemberBot/)
})

test('prompt builders do not send messages', () => {
  const text = readFileSync(join(root, 'rooms/studio/runtime/prompts.js'), 'utf8')
  assert.doesNotMatch(text, /sendTurn|engine\./, 'prompts.js both builds prompts and delivers them')
})

test('base HTTP paths stay inside the base adapter', () => {
  for (const file of walk('.')) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    const text = readFileSync(join(root, file), 'utf8')
    assert.doesNotMatch(text, /\/api\//, `${file} knows a base HTTP path`)
  }
  const engine = readFileSync(new URL('../engine.js', import.meta.url), 'utf8')
  assert.doesNotMatch(engine, /\/api\//, 'engine.js knows a base HTTP path')
})
