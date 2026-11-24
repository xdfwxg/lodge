import assert from 'node:assert/strict'
import test from 'node:test'
import { ROLE_DEFINITIONS } from '../../shared/role-definitions.js'
import { stageGuidance, workContract } from './prompt-modes.js'

test('the three role prompts are the latest contract', () => {
  const lead = ROLE_DEFINITIONS.lead.prompt
  assert.match(lead, /你是规划师，对接执行官、验收员/)
  assert.match(lead, /不写文件、不验收/)
  assert.match(lead, /任务很小就一步交付，不为流程硬拆阶段/)
  const worker = ROLE_DEFINITIONS.worker.prompt
  assert.match(worker, /你是执行官，交付给验收员/)
  assert.match(worker, /卡住找规划师/)
  assert.match(worker, /不自评“合格”/)
  assert.match(worker, /完成或卡住，最后一句写清交给谁/)
  const verifier = ROLE_DEFINITIONS.verifier.prompt
  assert.match(verifier, /你是验收员，只核验/)
  assert.match(verifier, /第一行只写 通过 或 不通过/)
  assert.match(verifier, /证据不足即为不通过/)
  assert.match(verifier, /合格说“规划师，可以收尾了”，不合格说“执行官，按上面的意见改一下”/)
  // 下一棒由系统投递；成员只写名字，不写 @。
  assert.match(lead, /系统负责把任务送到对方手里/)
  assert.match(lead, /不要写 @/)
  assert.match(worker, /系统负责投递/)
  assert.match(worker, /不要写 @/)
  assert.match(verifier, /系统负责投递/)
  assert.match(verifier, /不要写 @/)
  for (const prompt of [lead, worker, verifier]) {
    assert.doesNotMatch(prompt, /最后一行必须 @|最后一行只写 @|交接必须 @|@ 下一位/)
  }
  // 决策卡的问题是一句短问题，背景和后果留给选项。
  assert.match(lead, /问题只写一句、不超过 30 字/)
  // 用户说停时，规划师有一个机器认得的停止动作。
  assert.match(lead, /lodge_gate_stop_round/)
  assert.match(workContract('lead').join('\n'), /lodge_gate_stop_round/)
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
    assert.match(workContract(role).join('\n'), /交给谁（写名字，不带 @）/)
    assert.match(workContract(role).join('\n'), /没有下一棒时/)
    assert.match(workContract(role).join('\n'), /系统会把完整任务送到对方手里/)
    assert.doesNotMatch(workContract(role).join('\n'), /最后一行必须 @|最后一行只写 @|交接必须 @/)
  }
  assert.deepEqual(workContract('unknown'), [])
})

test('only dynamic stage constraints are added per prompt', () => {
  assert.deepEqual(stageGuidance({}), [])
  assert.match(stageGuidance({ readOnly: true }).join('\n'), /只读/)
})

