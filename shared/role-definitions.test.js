import test from 'node:test'
import assert from 'node:assert/strict'
import { materializeRole, roleDefinitionOf } from './role-definitions.js'
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
})

test('role instances copy the definition instead of sharing mutable arrays', () => {
  const first = materializeRole('worker')
  const second = materializeRole('worker')
  first.skills.push('changed')
  first.permissions.write = false
  assert.deepEqual(second.skills, [])
  assert.equal(second.permissions.write, true)
  assert.equal(membersFor('delivery-triad')[1].role, 'worker')
})
