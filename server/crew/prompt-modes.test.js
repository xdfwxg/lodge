import assert from 'node:assert/strict'
import test from 'node:test'
import { ROLE_DEFINITIONS } from '../../shared/role-definitions.js'
import { stageGuidance, workContract } from './prompt-modes.js'

test('the three role prompts are the latest contract', () => {
  const lead = ROLE_DEFINITIONS.lead.prompt
  assert.match(lead, /你是规划师，对接 @执行官、@验收员/)
  assert.match(lead, /不写文件、不验收/)
  assert.match(lead, /任务很小就一步交付，不为流程硬拆阶段/)
  const worker = ROLE_DEFINITIONS.worker.prompt
  assert.match(worker, /你是执行官，交付给 @验收员/)
  assert.match(worker, /卡住找 @规划师/)
  assert.match(worker, /不自评“合格”/)
  const verifier = ROLE_DEFINITIONS.verifier.prompt
  assert.match(verifier, /你是验收员，只核验/)
  assert.match(verifier, /第一行只写 通过 或 不通过/)
  assert.match(verifier, /证据不足即为不通过/)
  assert.match(verifier, /合格则 @规划师 收尾，不合格 @执行官 重做/)
})

test('work contracts carry only the system mechanics the prompts do not', () => {
  assert.match(workContract('worker').join('\n'), /不要自己 git commit/)
  assert.match(workContract('worker').join('\n'), /不要创建额外的报告/)
  assert.match(workContract('worker').join('\n'), /必须有测试改动/)
  assert.match(workContract('verifier').join('\n'), /只在自己的复核副本里读文件/)
  assert.match(workContract('verifier').join('\n'), /与阶段目标无关的新增文件/)
  assert.match(workContract('verifier').join('\n'), /diff 之外/)
  assert.match(workContract('lead').join('\n'), /lodge_gate_ask_decision/)
  assert.match(workContract('lead').join('\n'), /lodge_gate_rewind_stage/)
  for (const role of ['lead', 'worker', 'verifier']) {
    assert.match(workContract(role).join('\n'), /交接时在群里 @ 下一位/)
    assert.match(workContract(role).join('\n'), /系统负责把完整任务送过去/)
  }
  assert.deepEqual(workContract('unknown'), [])
})

test('only dynamic stage constraints are added per prompt', () => {
  assert.deepEqual(stageGuidance({}), [])
  assert.match(stageGuidance({ readOnly: true }).join('\n'), /只读/)
})

