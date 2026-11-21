import assert from 'node:assert/strict'
import test from 'node:test'
import { stageGuidance, workContract } from './prompt-modes.js'

test('work contracts carry stage discipline, not room identity', () => {
  assert.match(workContract('worker').join('\n'), /不要自己 git commit/)
  assert.match(workContract('worker').join('\n'), /不要创建额外的报告/)
  assert.match(workContract('worker').join('\n'), /不要 @ 验收员或规划师/)
  assert.match(workContract('worker').join('\n'), /复核由系统安排/)
  assert.match(workContract('verifier').join('\n'), /第一行只写 PASS 或 REJECT/)
  assert.match(workContract('verifier').join('\n'), /只在自己的复核副本里读文件/)
  assert.match(workContract('verifier').join('\n'), /与阶段目标无关的新增文件/)
  assert.match(workContract('verifier').join('\n'), /系统会把判定交给执行成员重做/)
  assert.match(workContract('lead').join('\n'), /对齐由系统自动确认/)
  assert.match(workContract('lead').join('\n'), /已经有交接单或方案时，直接按步骤派发，不再重复对齐/)
  assert.match(workContract('lead').join('\n'), /只在决策阶段用选项卡/)
  assert.match(workContract('lead').join('\n'), /目标还模糊就先问清/)
  assert.match(workContract('lead').join('\n'), /不要为了走流程而多写一份文档或工单/)
  for (const role of ['lead', 'worker', 'verifier']) {
    assert.match(workContract(role).join('\n'), /交接由系统完成/)
    assert.match(workContract(role).join('\n'), /不要用 @ 安排下一位/)
  }
  assert.deepEqual(workContract('unknown'), [])
})

test('only dynamic stage constraints are added per prompt', () => {
  assert.deepEqual(stageGuidance({}), [])
  assert.match(stageGuidance({ readOnly: true }).join('\n'), /只读/)
})

