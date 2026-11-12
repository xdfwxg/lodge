import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deliveryBundle, importDeliveries, readImportedDeliveries } from './delivery-ledger.js'

const delivery = (over = {}) => ({
  roomId: 'room-1',
  name: '交付一',
  goal: '目标',
  completedAt: 100,
  commit: 'abc',
  stages: 2,
  commands: 1,
  changedFiles: 3,
  ...over,
})

test('delivery summaries import, deduplicate and read back', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-deliveries-'))
  try {
    const items = importDeliveries({ dataDir: dir, bundle: { deliveries: [delivery(), delivery({ roomId: 'room-2', name: '交付二', commit: 'def' })] } })
    assert.equal(items.length, 2)
    const merged = importDeliveries({ dataDir: dir, bundle: { deliveries: [delivery({ commands: 4 })] } })
    assert.equal(merged.length, 2)
    assert.equal(merged.find(item => item.roomId === 'room-1').commands, 4)
    assert.deepEqual(readImportedDeliveries(dir).map(item => item.roomId).sort(), ['room-1', 'room-2'])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an invalid delivery bundle is rejected', () => {
  assert.throws(() => importDeliveries({ dataDir: '/tmp', bundle: {} }), /deliveries/)
})

test('the local bundle only includes completed rooms', () => {
  const rooms = [
    { id: 'r1', name: '完成', goal: 'g', state: 'complete', completedAt: 1, completedCommit: 'abc', stages: [], workspace: { capabilities: {} } },
    { id: 'r2', name: '进行中', goal: 'g', state: 'active', stages: [] },
  ]
  const bundle = deliveryBundle(rooms, () => [])
  assert.deepEqual(bundle.deliveries.map(item => item.roomId), ['r1'])
})
