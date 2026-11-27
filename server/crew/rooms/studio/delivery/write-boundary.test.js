import assert from 'node:assert/strict'
import test from 'node:test'
import { addedFilesOf, allowedFilesFor, filesOutsidePackage, ownsProofFileFor } from './write-boundary.js'

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
    { title: '导出', files: ['src/export.js'], clauseIds: ['export'] },
    { title: '说明', files: ['README.md'], clauseIds: ['docs'] },
  ],
  ...over,
})

test('parallel packages map to executors in order; the proof file is always allowed', () => {
  assert.deepEqual(allowedFilesFor({ room: room(), stage: stage(), memberId: 'a' }), ['src/export.js', 'lodge-proof.json', 'lodge-proof'])
  assert.deepEqual(allowedFilesFor({ room: room(), stage: stage(), memberId: 'b' }), ['README.md', 'lodge-proof.json', 'lodge-proof'])
})

test('the orchestration recorded on the round still splits packages per executor', () => {
  // 房间字段没有 orchestration、只有轮次上有时，也不能退化成“谁都能写”。
  const roundScoped = { orchestration: null, workRound: { orchestration: 'parallel' }, members: room().members }
  assert.deepEqual(allowedFilesFor({ room: roundScoped, stage: stage(), memberId: 'b' }), ['README.md', 'lodge-proof.json', 'lodge-proof'])
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

test('clauses follow the same package mapping as the write boundary', () => {
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

test('only new files the proof names are allowed outside the package', () => {
  const proofText = JSON.stringify({ entry: 'sh tools/prove.sh', steps: [{ run: 'sh tools/prove.sh' }] })
  // 新加 + 证明点名 → 放行（证明脚本是这一步的交付）。
  assert.deepEqual(filesOutsidePackage({
    files: ['tools/prove.sh'],
    allowed: ['hello.txt'],
    added: ['tools/prove.sh'],
    proofText,
  }), [])
  // 新加、但证明没提 → 仍然越界（防止借证明名头夹带）。
  assert.deepEqual(filesOutsidePackage({
    files: ['tools/other.sh'],
    allowed: ['hello.txt'],
    added: ['tools/other.sh'],
    proofText,
  }), ['tools/other.sh'])
  // 证明入口所在目录里的新辅助脚本：入口 import 它们，同一个证明。
  assert.deepEqual(filesOutsidePackage({
    files: ['tools/prove.sh', 'tools/helper.mjs'],
    allowed: ['hello.txt'],
    added: ['tools/prove.sh', 'tools/helper.mjs'],
    proofText,
  }), [])
  // 包里的入口被证明点名去跑时，同目录的新辅助脚本也是证明的一部分。
  assert.deepEqual(filesOutsidePackage({
    files: ['tools/check.mjs', 'tools/selftest.mjs'],
    allowed: ['hello.txt', 'tools/check.mjs'],
    added: ['tools/selftest.mjs'],
    proofText: JSON.stringify({ entry: 'node tools/check.mjs', steps: [{ run: 'node tools/check.mjs' }] }),
  }), [])
  // 别的目录里的新文件不能借同一个证明夹带。
  assert.deepEqual(filesOutsidePackage({
    files: ['tools/prove.sh', 'src/sneaky.js'],
    allowed: ['hello.txt'],
    added: ['tools/prove.sh', 'src/sneaky.js'],
    proofText,
  }), ['src/sneaky.js'])
  // 改已有文件、即使证明提到 → 越界（越界修改不在放行范围）。
  assert.deepEqual(filesOutsidePackage({
    files: ['tools/prove.sh'],
    allowed: ['hello.txt'],
    added: [],
    proofText,
  }), ['tools/prove.sh'])
})

test('git status tells added files from modified ones', () => {
  assert.deepEqual(addedFilesOf('?? tools/prove.sh\nA  tools/new.mjs\n M src/other.js\nM  src/app.js\n'), [
    'tools/prove.sh',
    'tools/new.mjs',
  ])
  assert.deepEqual(addedFilesOf(''), [])
})

test('absolute package paths normalize against the workspace root', () => {
  assert.deepEqual(allowedFilesFor({
    room: room(),
    stage: { packages: [{ title: '导出', files: ['/tmp/room/src/export.js'] }] },
    memberId: 'a',
    root: '/tmp/room',
  }), ['src/export.js', 'lodge-proof.json', 'lodge-proof'])
})

test('the package that owns lodge-proof.json keeps it at the root', () => {
  // 并行时只有一个包认领证明文件：它留在根目录，别人写的根证明才挪成分片。
  const parallel = {
    orchestration: 'parallel',
    members: [{ id: 'a', role: 'worker' }, { id: 'b', role: 'worker' }],
    stages: [{
      assignees: ['a', 'b'],
      packages: [
        { files: ['hello.txt'], clauseIds: ['c1'] },
        { files: ['lodge-proof.json'], clauseIds: ['c2'] },
      ],
    }],
  }
  assert.equal(ownsProofFileFor({ room: parallel, stage: parallel.stages[0], memberId: 'a' }), false)
  assert.equal(ownsProofFileFor({ room: parallel, stage: parallel.stages[0], memberId: 'b' }), true)
  // 单执行官拿走全部包时，他自然拥有证明文件。
  assert.equal(ownsProofFileFor({ room: { ...parallel, orchestration: 'pipeline' }, stage: parallel.stages[0], memberId: 'a' }), true)
})
