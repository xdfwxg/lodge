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
  // 交接必须写死在最后一行；模型省掉 @ 时房间看不到接力。
  assert.match(worker, /完成或卡住，最后一行只写 @ 下一位 加一句动作/)
  const verifier = ROLE_DEFINITIONS.verifier.prompt
  assert.match(verifier, /你是验收员，只核验/)
  assert.match(verifier, /第一行只写 通过 或 不通过/)
  assert.match(verifier, /证据不足即为不通过/)
  assert.match(verifier, /合格写 @规划师 收尾，不合格写 @执行官 重做/)
  assert.match(lead, /交接必须 @ 下一位/)
  // 决策卡的问题是一句短问题，背景和后果留给选项。
  assert.match(lead, /问题只写一句、不超过 30 字/)
  // 用户说停时，规划师有一个机器认得的停止动作。
  assert.match(lead, /lodge_gate_stop_round/)
  assert.match(workContract('lead').join('\n'), /lodge_gate_stop_round/)
  // 三个角色的接力位置一致：正文不 @，最后一行只写交接。
  assert.match(lead, /最后一行只写 @ 下一位 加一句动作/)
  assert.match(lead, /@ 只出现在最后一行/)
  // 没有下一棒时不能硬凑一个 @（模型会 @ 自己）。
  assert.match(lead, /停下、等用户回答或事情到此为止时，不 @ 任何人/)
  assert.match(worker, /正文提到成员时不带 @/)
  assert.match(verifier, /正文提到成员时不带 @/)
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
    assert.match(workContract(role).join('\n'), /最后一行必须 @ 下一位/)
    assert.match(workContract(role).join('\n'), /没有下一棒时/)
    assert.match(workContract(role).join('\n'), /系统负责把完整任务送过去/)
  }
  assert.deepEqual(workContract('unknown'), [])
})

test('only dynamic stage constraints are added per prompt', () => {
  assert.deepEqual(stageGuidance({}), [])
  assert.match(stageGuidance({ readOnly: true }).join('\n'), /只读/)
})

