import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deleteSavedRoomTemplate, listSavedRoomTemplates, saveSavedRoomTemplate } from './room-template-store.js'

test('custom room templates persist and can be deleted', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-room-templates-'))
  try {
    const template = {
      id: 'custom-review',
      name: '自定义评审',
      roomType: 'studio',
      description: '自定义模板',
      verify: 'manual',
      seats: [
        { role: 'lead', name: '规划师' },
        { role: 'worker', name: '执行者' },
        { role: 'verifier', name: '验收员' },
      ],
    }
    saveSavedRoomTemplate({ dataDir, template })
    assert.equal(listSavedRoomTemplates(dataDir)[0].id, 'custom-review')
    assert.equal(deleteSavedRoomTemplate({ dataDir, id: 'custom-review' }), true)
    assert.deepEqual(listSavedRoomTemplates(dataDir), [])
  } finally {
    rmSync(dataDir, { recursive: true, force: true })
  }
})
