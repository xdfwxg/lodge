import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { externalUrl, openablePath, runtimeBinary, sameOrigin } from './policy.mjs'

test('sameOrigin rejects userinfo tricks', () => {
  const origin = 'http://127.0.0.1:8787'
  assert.equal(sameOrigin('http://127.0.0.1:8787/rooms/1', origin), true)
  assert.equal(sameOrigin('http://127.0.0.1:8787@evil.com/x', origin), false)
  assert.equal(sameOrigin('https://127.0.0.1:8787/x', origin), false)
  assert.equal(sameOrigin('not a url', origin), false)
})

test('external links only allow http and https', () => {
  assert.equal(externalUrl('https://example.com/a'), 'https://example.com/a')
  assert.equal(externalUrl('http://example.com/a'), 'http://example.com/a')
  assert.equal(externalUrl('file:///tmp/run.command'), null)
  assert.equal(externalUrl('javascript:alert(1)'), null)
  assert.equal(externalUrl('bad url'), null)
})

test('openable paths exclude executables and app bundles', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-policy-'))
  try {
    const folder = join(root, 'work')
    const text = join(root, 'notes.md')
    const script = join(root, 'run.command')
    const binary = join(root, 'tool')
    const app = join(root, 'Fake.app')
    mkdirSync(folder)
    mkdirSync(app)
    writeFileSync(text, '# notes\n')
    writeFileSync(script, '#!/bin/sh\n')
    writeFileSync(binary, '#!/bin/sh\n')
    chmodSync(binary, 0o755)
    assert.equal(openablePath(folder).ok, true)
    assert.equal(openablePath(text).ok, true)
    assert.equal(openablePath(script).ok, false)
    assert.equal(openablePath(binary).ok, false)
    assert.equal(openablePath(app).ok, false)
    assert.equal(openablePath(join(root, 'missing')).ok, false)
    assert.equal(openablePath('').ok, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('runtime binaries cannot escape their directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-runtime-'))
  try {
    const runtime = join(root, 'pi')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'pi'), '#!/bin/sh\n')
    assert.equal(runtimeBinary(runtime, 'pi'), realpathSync(join(runtime, 'pi')))
    assert.equal(runtimeBinary(runtime, '../outside'), null)
    assert.equal(runtimeBinary(runtime, join(root, 'outside')), null)
    assert.equal(runtimeBinary(runtime, 'missing'), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
