import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('.', import.meta.url))

const applicationFiles = [
  'room-create.js',
  'room-create-input.js',
  'room-create-start.js',
  'room-record.js',
  'room-workspace.js',
  'room-provision.js',
  'room-complete.js',
  'service.js',
  'service-queries.js',
  'service-templates.js',
  'service-delivery.js',
  'service-seats.js',
  'service-seat-add.js',
  'service-seat-remove.js',
  'service-stages.js',
  'service-run-control.js',
  'live.js',
  'live-projection.js',
  'live-refresh.js',
  'live-approvals.js',
  'live-sync.js',
  'live-turns.js',
  'live-acceptance.js',
  'live-integration.js',
  'live-review.js',
  'live-stage.js',
  'live-turn-state.js',
  'live-workspace.js',
  'startup-repair.js',
  'room-repair.js',
  'roster-recommend.js',
  'handoff.js',
  'workspace-gc.js',
  'dispatch-service.js',
  'demo.js',
  'review.js',
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
  'delivery-ledger.js',
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
      const pattern = new RegExp(`from\\s+['"]\\./${dependency.replaceAll('.', '\\.')}['"]`)
      assert.doesNotMatch(text, pattern, `${file} imports concrete dependency ${dependency}`)
    }
    assert.doesNotMatch(text, /from\s+['"]node:fs['"]/, `${file} imports node:fs directly`)
  }
})
