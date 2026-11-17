import assert from 'node:assert/strict'
import test from 'node:test'
import { decisionDetail, parseDecisionItems } from './decision-brief.js'

const sample = '**目标对齐 · 结论**\n\n- 目标：给准备发布的团队一份能直接照着勾的清单。\n- 结构：代码、发布、回滚三组，每条带勾选框和负责人。\n- 检查：文件里三组检查齐全，能直接照着勾。\n\n@you 定下这三点后，交执行官写清单。'

test('the supplement drops repeated decisions and the heading', () => {
  assert.equal(decisionDetail(sample, parseDecisionItems(sample)), '定下这三点后，交执行官写清单。')
})

test('the supplement is empty when only decisions remain', () => {
  const text = '**结论**\n\n- 目标：A\n- 检查：B'
  assert.equal(decisionDetail(text, parseDecisionItems(text)), '')
})
