import assert from 'node:assert/strict'
import test from 'node:test'
import { allowedFilesFor, filesOutsidePackage } from './write-boundary.js'

const room = ({ orchestration = 'parallel' } = {}) => ({
  orchestration,
  members: [
    { id: 'a', role: 'worker' },
    { id: 'b', role: 'worker' },
    { id: 'c', role: 'verifier' },
  ],
})

const stage = over => ({
  packages: [
    { title: '导出', files: ['src/export.js'] },
    { title: '说明', files: ['README.md'] },
  ],
  ...over,
})

test('parallel packages map to executors in order; the proof file is always allowed', () => {
  assert.deepEqual(allowedFilesFor({ room: room(), stage: stage(), memberId: 'a' }), ['src/export.js', 'lodge-proof.json', 'lodge-proof'])
  assert.deepEqual(allowedFilesFor({ room: room(), stage: stage(), memberId: 'b' }), ['README.md', 'lodge-proof.json', 'lodge-proof'])
})

test('a single executor owns every package in the stage', () => {
  assert.deepEqual(allowedFilesFor({ room: room({ orchestration: 'pipeline' }), stage: stage(), memberId: 'a' }), [
    'src/export.js',
    'README.md',
    'lodge-proof.json',
    'lodge-proof',
  ])
})

test('without packages the executor keeps the whole workspace', () => {
  assert.equal(allowedFilesFor({ room: room(), stage: { packages: [] }, memberId: 'a' }), null)
  assert.equal(allowedFilesFor({ room: room(), stage: null, memberId: 'a' }), null)
})

test('a member outside the dispatch has no package claim', () => {
  assert.equal(allowedFilesFor({ room: room(), stage: stage({ assignees: ['b'] }), memberId: 'a' }), null)
})

test('files outside the package are detected, including directory prefixes', () => {
  assert.deepEqual(filesOutsidePackage({
    files: ['src/export.js', 'src/other.js', 'README.md', 'notes/todo.md'],
    allowed: ['src/export.js', 'README.md'],
  }), ['src/other.js', 'notes/todo.md'])
  assert.deepEqual(filesOutsidePackage({
    files: ['src/export/button.js', 'src/export/panel.js', 'src/other.js'],
    allowed: ['src/export/'],
  }), ['src/other.js'])
  assert.deepEqual(filesOutsidePackage({ files: ['src/a.js'], allowed: ['src'] }), [])
})

test('absolute package paths normalize against the workspace root', () => {
  assert.deepEqual(allowedFilesFor({
    room: room(),
    stage: { packages: [{ title: '导出', files: ['/tmp/room/src/export.js'] }] },
    memberId: 'a',
    root: '/tmp/room',
  }), ['src/export.js', 'lodge-proof.json', 'lodge-proof'])
})
