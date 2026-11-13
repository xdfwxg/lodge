import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePlannerTool, PLANNER_TOOL_NAMES, plannerToolPrompt } from './planner-tools.js'

test('Planner tool protocol only accepts the declared tools', () => {
  assert.deepEqual(parsePlannerTool('<lodge-tool>{"name":"create_subroom","args":{"goal":"x"}}</lodge-tool>'), {
    name: 'create_subroom',
    args: { goal: 'x' },
  })
  assert.equal(parsePlannerTool('<lodge-tool>{"name":"shell","args":{}}</lodge-tool>'), null)
  assert.equal(parsePlannerTool('ordinary reply'), null)
  assert.ok(plannerToolPrompt().some(line => line.includes('create_subroom')))
  assert.deepEqual(PLANNER_TOOL_NAMES, ['create_subroom', 'reject_plan', 'check_gate'])
})
