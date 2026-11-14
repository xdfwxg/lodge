import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

const applicationFiles = [
  'room-create.js',
  'room-create-input.js',
  'rooms/studio/start.js',
  'room-record.js',
  'room-workspace.js',
  'room-provision.js',
  'rooms/studio/complete.js',
  'service.js',
  'service-queries.js',
  'rooms/studio/service-delivery.js',
  'service-seats.js',
  'service-seat-add.js',
  'service-seat-remove.js',
  'rooms/studio/service-stages.js',
  'rooms/studio/service-closure.js',
  'rooms/studio/service-trust.js',
  'rooms/studio/service-subrooms.js',
  'service-run-control.js',
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
  'rooms/studio/facade.js',
  'rooms/studio/prompts.js',
  'live-projection.js',
  'live-refresh.js',
  'live-approvals.js',
  'live-sync.js',
  'rooms/studio/turns.js',
  'rooms/studio/acceptance-runner.js',
  'rooms/studio/integration.js',
  'rooms/studio/review.js',
  'rooms/studio/stage.js',
  'rooms/studio/turn-state.js',
  'rooms/studio/workspace.js',
  'rooms/studio/delivery.js',
  'rooms/studio/gates.js',
  'rooms/studio/review-report.js',
  'rooms/studio/repair.js',
  'rooms/studio/subrooms.js',
  'rooms/studio/verifiers.js',
  'rooms/studio/stage-plan.js',
  'rooms/studio/tasks.js',
  'rooms/studio/progress.js',
  'rooms/studio/seat-handoff.js',
  'rooms/studio/handoff.js',
  'rooms/studio/demo.js',
  'rooms/studio/gate.js',
  'rooms/studio/startup-repair.js',
  'roster-recommend.js',
  'workspace-gc.js',
  'resources.js',
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
  'usage-history.js',
  'template-store.js',
  'room-template-store.js',
  'skill-store.js',
  'handoff-store.js',
  'acceptance.js',
  'sandbox.js',
  'lock.js',
  'workspace-git.js',
  'workspace-direct.js',
  'workspace-plain.js',
  'system-open.js',
  'system-dialog.js',
]

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
