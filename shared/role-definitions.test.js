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
  assert.match(roleDefinitionOf('lead').prompt, /下一步和谁做/)
  assert.match(roleDefinitionOf('lead').prompt, /只问一个最关键的问题/)
  assert.match(roleDefinitionOf('worker').prompt, /做完没有、证据在哪/)
  assert.match(roleDefinitionOf('worker').prompt, /不复述任务/)
  assert.match(roleDefinitionOf('verifier').prompt, /先给判定，再给证据/)
  assert.match(roleDefinitionOf('verifier').prompt, /不替作者解释/)
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
