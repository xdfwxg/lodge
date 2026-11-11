import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { importHandoff } from './handoff.js'
import { createStore } from './store.js'

const samples = fileURLToPath(new URL('../../examples/rooms/', import.meta.url))

test('every committed sample imports as a sanitized read-only room', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'lodge-examples-'))
  const store = createStore({ dataDir })
  const files = readdirSync(samples).filter(name => name.endsWith('.lodge.json'))
  assert.equal(files.length >= 3, true)
  for (const name of files) {
    const bundle = JSON.parse(readFileSync(join(samples, name), 'utf8'))
    assert.equal(bundle.sanitized, true, `${name} is not sanitized`)
    assert.equal(typeof bundle.sample?.kind, 'string', `${name} is not labelled`)
    const result = importHandoff({ store, dataDir, bundle })
    assert.equal(result.ok, true, `${name}: ${result.error}`)
    assert.equal(result.room.readOnly, true)
    assert.equal(store.readMessages(result.room.id).length > 0, true)
  }
})
