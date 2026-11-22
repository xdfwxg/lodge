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
  assert.deepEqual(planner.skills, skillsForRole('lead'))
})

test('each role prompt carries its own speech habit', () => {
  assert.match(roleDefinitionOf('lead').prompt, /下一步和对接人/)
  assert.match(roleDefinitionOf('lead').prompt, /只问一个核心问题/)
  assert.match(roleDefinitionOf('lead').prompt, /lodge_gate_ask_question/)
  assert.match(roleDefinitionOf('lead').prompt, /不编造证据/)
  assert.match(roleDefinitionOf('worker').prompt, /完成状态 \+ 证据/)
  assert.match(roleDefinitionOf('worker').prompt, /不自评“合格”/)
  assert.match(roleDefinitionOf('verifier').prompt, /第一行只写 通过 或 不通过/)
  assert.match(roleDefinitionOf('verifier').prompt, /不为产出解释/)
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
