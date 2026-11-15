import assert from 'node:assert/strict'
import test from 'node:test'
import { workBeatOf } from './beat.js'

test('a short message is its own work beat', () => {
  assert.deepEqual(workBeatOf('已交付 · npm test exit 0'), {
    preview: '已交付 · npm test exit 0',
    rest: '',
  })
})

test('the first paragraph stays in the beat and the rest expands', () => {
  const beat = workBeatOf('执行官已交付。\n\n依据：三条测试都通过。')
  assert.equal(beat.preview, '执行官已交付。')
  assert.equal(beat.rest, '依据：三条测试都通过。')
})

test('a short heading is shown together with its body', () => {
  const beat = workBeatOf('**工作日志**\n\n- 做了什么：写清单\n- 结果：检查通过')
  assert.equal(beat.preview, '**工作日志**\n\n- 做了什么：写清单\n- 结果：检查通过')
  assert.equal(beat.rest, '')
})

test('a long first paragraph is cut near a sentence boundary', () => {
  const text = `${'实现细节。'.repeat(60)}最后一句。`
  const beat = workBeatOf(text, 80)
  assert.equal(beat.preview.endsWith('。'), true)
  assert.equal(beat.preview.length <= 80, true)
  assert.equal(beat.rest.startsWith('实现细节'), true)
  assert.equal(`${beat.preview}${beat.rest}`.includes('最后一句。'), true)
})

test('empty text produces an empty beat', () => {
  assert.deepEqual(workBeatOf('   '), { preview: '', rest: '' })
})
