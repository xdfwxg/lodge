import assert from 'node:assert/strict'
import test from 'node:test'
import { emphasizeImportant } from './emphasis.js'

test('important files, steps and next actions are bold when the member did not emphasize them', () => {
  assert.equal(
    emphasizeImportant('`color.md` 建好了，下一步是验收。'),
    '**color.md** 建好了，**下一步**是验收。',
  )
  assert.equal(
    emphasizeImportant('第 2 步已完成，风险是路径不一致。'),
    '**第 2 步**已完成，**风险**是路径不一致。',
  )
})

test('a member who already used bold is left alone', () => {
  assert.equal(emphasizeImportant('**color.md** 已建好'), '**color.md** 已建好')
})

test('code keeps its shape unless it is a delivery file', () => {
  assert.equal(emphasizeImportant('```\ncolor.md\n```'), '```\ncolor.md\n```')
  assert.equal(emphasizeImportant('行尾是 `\\r`，文件是 `color.md`'), '行尾是 `\\r`，文件是 **color.md**')
})

test('adjacent labels merge into one bold run instead of leaking stars', () => {
  const out = emphasizeImportant('第 2 步已通过：welcome.md 现在三行。')
  assert.equal(out, '**第 2 步已通过**：**welcome.md** 现在三行。')
  assert.doesNotMatch(out, /\*\*\*\*/)
})
