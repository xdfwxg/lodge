import assert from 'node:assert/strict'
import test from 'node:test'
import { memoryMetaOf, memoryNotesOf } from './memory-notes.js'

test('a memory entry shows the last rejection reasons before the files', () => {
  const notes = memoryNotesOf({
    rejections: [
      { stage: 0, reason: '按钮没有加载态' },
      { stage: 1, reason: '刷新后设置会丢' },
    ],
    files: ['src/settings.js', 'src/view.js'],
  })
  assert.deepEqual(notes, [
    { kind: 'reject', text: '上次退回（第 1 步）：按钮没有加载态' },
    { kind: 'reject', text: '上次退回（第 2 步）：刷新后设置会丢' },
    { kind: 'files', text: '当时改过：src/settings.js、src/view.js' },
  ])
})

test('a long file list is clipped with a count', () => {
  const notes = memoryNotesOf({ files: ['a', 'b', 'c', 'd', 'e', 'f'] })
  assert.equal(notes[0].text, '当时改过：a、b、c、d、e 等 6 个')
})

test('an old entry without rejections keeps its quiet meta line', () => {
  assert.deepEqual(memoryNotesOf({ files: [] }), [])
  assert.match(memoryMetaOf({ completedAt: 0, stages: [{}, {}], verdict: { pass: false } }), /2 步 · 退回$/)
})
