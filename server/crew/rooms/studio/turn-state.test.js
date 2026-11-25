import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submitPlanOf } from '../../../../shared/gate.js'
import { writeGateSubmission } from '../../gate/spool.js'
import { createTurnState } from './turn-state.js'

const spool = mkdtempSync(join(tmpdir(), 'lodge-turn-spool-'))
process.env.LODGE_GATE_SPOOL = spool
after(() => rmSync(spool, { recursive: true, force: true }))

const state = () => createTurnState({ store: {}, roomId: 'room-1', emit: () => {} })

test('a cut tool preview is replaced by the full submission the gate stored', () => {
  const args = {
    contract: {
      outcomes: [{ id: 'title-size-28', statement: '标题 28px', observable: '.title 为 28px' }],
      boundaries: ['只改样式'],
      nonGoals: ['不改结构'],
      assumptions: [],
    },
    plan: { stages: [{ title: '改字号', deliverable: '标题 28px', clauseIds: ['title-size-28'], packages: [{ title: '改 CSS', files: ['draft/report.html'], clauseIds: ['title-size-28'] }] }] },
    crew: { executors: [{ engine: 'claude', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
  }
  const submissionId = writeGateSubmission(args)
  const turns = state()
  turns.trackTool({
    kind: 'activity',
    turnId: 'turn-1',
    tool: {
      name: 'mcp__lodge_gate__submit_plan',
      input: '{"plan":{"stages":[{"packages":[{"clauseIds":["[additional data omitted]"]}]}]}}',
      output: JSON.stringify({ ok: true, kind: 'plan', submissionId }),
    },
  })
  const call = turns.turns.get('turn-1')[0]
  assert.deepEqual(JSON.parse(call.input), args)
  const result = submitPlanOf(turns.turns.get('turn-1'))
  assert.equal(result.error, undefined)
  assert.equal(result.proposal.plan.stages[0].packages[0].clauseIds[0], 'title-size-28')
})

test('a completed tool call replaces the started preview for the same item', () => {
  const args = {
    contract: {
      outcomes: [{ id: 'title-size-28', statement: '标题 28px', observable: '.title 为 28px' }],
      boundaries: ['只改样式'],
      nonGoals: ['不改结构'],
      assumptions: [],
    },
    plan: { stages: [{ title: '改字号', deliverable: '标题 28px', clauseIds: ['title-size-28'], packages: [{ title: '改 CSS', files: ['draft/report.html'], clauseIds: ['title-size-28'] }] }] },
    crew: { executors: [{ engine: 'claude', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
  }
  const submissionId = writeGateSubmission(args)
  const turns = state()
  const base = {
    kind: 'activity',
    turnId: 'turn-4',
    tool: { id: 'call-1', name: 'mcp__lodge_gate__submit_plan', input: '{"truncated":true}' },
  }
  turns.trackTool(base)
  turns.trackTool({ ...base, tool: { ...base.tool, output: JSON.stringify({ ok: true, submissionId }) } })
  assert.equal(turns.turns.get('turn-4').length, 1)
  assert.deepEqual(JSON.parse(turns.turns.get('turn-4')[0].input), args)
})

test('a call without a gate receipt keeps its activity input', () => {
  const turns = state()
  turns.trackTool({
    kind: 'activity',
    turnId: 'turn-2',
    tool: { name: 'Bash', input: '{"command":"ls"}' },
  })
  assert.equal(turns.turns.get('turn-2')[0].input, '{"command":"ls"}')
})

test('a receipt without the full submission leaves the preview alone', () => {
  const turns = state()
  turns.trackTool({
    kind: 'activity',
    turnId: 'turn-3',
    tool: {
      name: 'mcp__lodge_gate__submit_plan',
      input: '{"truncated":true}',
      output: JSON.stringify({ ok: true, kind: 'plan' }),
    },
  })
  assert.equal(turns.turns.get('turn-3')[0].input, '{"truncated":true}')
})
