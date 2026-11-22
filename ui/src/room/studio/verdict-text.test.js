import assert from 'node:assert/strict'
import test from 'node:test'
import { splitVerdictText } from './verdict-text.js'

test('a verdict keeps one summary line and folds the rest', () => {
  assert.deepEqual(splitVerdictText('PASS\n命令通过，改动只在 src/pad.js。\n没有新增文件。'), {
    summary: '命令通过，改动只在 src/pad.js。',
    detail: '没有新增文件。',
  })
  assert.deepEqual(splitVerdictText('REJECT'), { summary: '', detail: '' })
  assert.deepEqual(splitVerdictText('人工确认通过。'), { summary: '人工确认通过。', detail: '' })
  assert.deepEqual(splitVerdictText(''), { summary: '', detail: '' })
  assert.deepEqual(splitVerdictText('PASS\n1. 命令退出码 0\n2. 文件齐全'), {
    summary: '',
    detail: '1. 命令退出码 0\n2. 文件齐全',
  })
})

test('a conclusion written on the PASS line is not swallowed', () => {
  assert.deepEqual(
    splitVerdictText('PASS 产物达标：greet(name) 返回 hello Ada，测试通过。 - 改动仅 src/greet.js。 - 测试文件未改。'),
    {
      summary: '产物达标：greet(name) 返回 hello Ada，测试通过。',
      detail: '- 改动仅 src/greet.js。 - 测试文件未改。',
    },
  )
  assert.deepEqual(splitVerdictText('PASS：产物达标。'), {
    summary: '产物达标。',
    detail: '',
  })
})

test('the Chinese verdict line is stripped without eating a normal sentence', () => {
  assert.deepEqual(splitVerdictText('通过\n文件齐全。'), { summary: '文件齐全。', detail: '' })
  assert.deepEqual(splitVerdictText('不通过：缺一条测试。'), { summary: '缺一条测试。', detail: '' })
  assert.deepEqual(splitVerdictText('通过率 98%，符合要求。'), { summary: '通过率 98%，符合要求。', detail: '' })
})
