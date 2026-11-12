import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deleteSavedTemplate, listSavedTemplates, saveSavedTemplate } from './template-store.js'

const template = (over = {}) => ({
  id: 'my-template',
  name: '我的模板',
  seats: [{ role: 'worker', name: '执行' }],
  ...over,
})

test('saved templates persist, list and delete locally', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lodge-templates-'))
  try {
    saveSavedTemplate({ dataDir: dir, template: template() })
    assert.deepEqual(listSavedTemplates(dir).map(item => item.id), ['my-template'])
    assert.equal(deleteSavedTemplate({ dataDir: dir, id: 'my-template' }), true)
    assert.deepEqual(listSavedTemplates(dir), [])
    assert.equal(deleteSavedTemplate({ dataDir: dir, id: 'missing' }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an invalid template id is rejected', () => {
  assert.throws(() => saveSavedTemplate({ dataDir: '/tmp', template: template({ id: '../x' }) }), /id/)
})
