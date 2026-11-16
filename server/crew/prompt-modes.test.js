import assert from 'node:assert/strict'
import test from 'node:test'
import { stageGuidance, workContract } from './prompt-modes.js'

test('work contracts carry stage discipline, not room identity', () => {
  assert.match(workContract('worker').join('\n'), /不要自己 git commit/)
  assert.match(workContract('worker').join('\n'), /不要创建额外的报告/)
  assert.match(workContract('worker').join('\n'), /完成后不用 @ 人，系统会把结果和证据交给验收员/)
  assert.match(workContract('worker').join('\n'), /只有真正阻塞、需要改派时才 @ 规划师/)
  assert.match(workContract('verifier').join('\n'), /第一行只写 PASS 或 REJECT/)
  assert.match(workContract('verifier').join('\n'), /只在自己的复核副本里读文件/)
  assert.match(workContract('verifier').join('\n'), /与阶段目标无关的新增文件/)
  assert.match(workContract('verifier').join('\n'), /退回时只写具体缺口，系统会把判定交给规划师/)
  assert.match(workContract('lead').join('\n'), /用户确认前不要派活/)
  assert.match(workContract('lead').join('\n'), /已经有交接单或方案时，直接按步骤派发，不再重复对齐/)
  assert.match(workContract('lead').join('\n'), /只问当前阶段新出现的分叉/)
  for (const role of ['lead', 'worker', 'verifier']) {
    assert.match(workContract(role).join('\n'), /每次 @ 都是交接/)
  }
  assert.deepEqual(workContract('unknown'), [])
})

test('only dynamic stage constraints are added per prompt', () => {
  assert.deepEqual(stageGuidance({}), [])
  assert.match(stageGuidance({ readOnly: true }).join('\n'), /只读/)
})

