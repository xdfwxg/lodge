import assert from 'node:assert/strict'
import test from 'node:test'
import { openablePath } from './system-policy.js'

// 判据是纯的：读文件系统的两件事由调用方注入，这里用假的替身。
const fs = ({ dir = false, file = false, exec = false } = {}) => ({
  stat: () => ({ isDirectory: () => dir, isFile: () => file, mode: exec ? 0o755 : 0o644 }),
  realpath: path => path,
})
const statOf = () => { throw new Error('missing') }

test('only plain files and folders can be handed to the system', () => {
  assert.equal(openablePath('/tmp/notes.md', fs({ file: true })).ok, true)
  assert.equal(openablePath('/tmp/folder', fs({ dir: true })).ok, true)
  assert.equal(openablePath('/tmp/run.sh', fs({ file: true })).ok, false)
  assert.equal(openablePath('/tmp/tool', fs({ file: true, exec: true })).ok, false)
  assert.equal(openablePath('/Applications/X.app', fs({ dir: true })).ok, false)
})

test('a missing path or empty input is refused with a reason', () => {
  assert.equal(openablePath('/nope', { stat: statOf, realpath: path => path }).error, '路径不存在')
  assert.equal(openablePath('   ', fs({ file: true })).error, '缺少路径')
})

test('a symlink that resolves to an app bundle is still refused', () => {
  const verdict = openablePath('/tmp/link', {
    stat: () => ({ isDirectory: () => true, isFile: () => false, mode: 0o755 }),
    realpath: () => '/Applications/Thing.app',
  })
  assert.equal(verdict.ok, false)
})
