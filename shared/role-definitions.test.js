import test from 'node:test'
import assert from 'node:assert/strict'
import { materializeRole, roleDefinitionOf } from './role-definitions.js'
import { skillsForRole } from './role-toolbox.js'
import { membersFor } from '../server/crew/roster.js'

test('each role definition carries the full reusable role contract', () => {
  const planner = roleDefinitionOf('lead')
  assert.equal(planner.name, '规划师')
  assert.equal(planner.id, 'planner')
  assert.equal(planner.permissions.write, false)
  assert.ok(planner.prompt.includes('规划师'))
  assert.ok(planner.rules.includes('不写文件'))
  assert.ok(planner.artifacts.includes('plan'))
  assert.ok(planner.gates.includes('plan-review'))
  assert.equal(planner.stance, '向未来看，先问对问题')
  assert.deepEqual(planner.skills, skillsForRole('lead'))
})

test('each role prompt carries its own speech habit', () => {
  assert.match(roleDefinitionOf('lead').prompt, /下一步和对接人/)
  assert.match(roleDefinitionOf('lead').prompt, /只问一个核心问题/)
  assert.match(roleDefinitionOf('lead').prompt, /lodge_gate_ask_question/)
  assert.match(roleDefinitionOf('lead').prompt, /lodge_gate_submit_plan/)
  assert.match(roleDefinitionOf('lead').prompt, /不编造证据/)
  assert.match(roleDefinitionOf('worker').prompt, /完成状态 \+ 证据/)
  assert.match(roleDefinitionOf('worker').prompt, /不自评“合格”/)
  assert.match(roleDefinitionOf('verifier').prompt, /第一行只写 通过 或 不通过/)
  assert.match(roleDefinitionOf('verifier').prompt, /不为产出解释/)
})

test('each role has a complete stance that can argue with the other two', () => {
  const lead = roleDefinitionOf('lead').prompt
  const worker = roleDefinitionOf('worker').prompt
  const verifier = roleDefinitionOf('verifier').prompt
  assert.equal(roleDefinitionOf('worker').stance, '能跑、能验、能交付才算数')
  assert.equal(roleDefinitionOf('verifier').stance, '没有证据的完成就是没完成')
  assert.match(lead, /立场：方向错了/)
  assert.match(worker, /立场：能跑、能验、能交付/)
  assert.match(verifier, /立场：没有证据的完成就是没完成/)
  assert.match(worker, /敢对规划师说不/)
  assert.match(verifier, /看得懂全局/)
})

test('role instances copy the definition instead of sharing mutable arrays', () => {
  const first = materializeRole('worker')
  const second = materializeRole('worker')
  first.skills.push('changed')
  first.permissions.write = false
  assert.deepEqual(second.skills, skillsForRole('worker'))
  assert.equal(second.permissions.write, true)
  assert.equal(membersFor('delivery-triad')[1].role, 'worker')
})
