import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { HANDOFF_FORMAT } from './handoff.js'

const samples = fileURLToPath(new URL('../../examples/rooms/', import.meta.url))

test('every committed sample stays a sanitized, labelled handoff bundle', () => {
  const files = readdirSync(samples).filter(name => name.endsWith('.lodge.json'))
  assert.equal(files.length >= 3, true)
  for (const name of files) {
    const bundle = JSON.parse(readFileSync(join(samples, name), 'utf8'))
    assert.equal(bundle.format, HANDOFF_FORMAT, `${name} is not a handoff bundle`)
    assert.equal(bundle.sanitized, true, `${name} is not sanitized`)
    assert.equal(typeof bundle.sample?.kind, 'string', `${name} is not labelled`)
  }
})
