import test from 'node:test'
import assert from 'node:assert/strict'
import { GATE_TOOLS, handleMessage } from './mcp-server.js'

test('the gate server speaks the minimal MCP handshake', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18' },
  })
  assert.equal(response.result.protocolVersion, '2025-06-18')
  assert.equal(response.result.serverInfo.name, 'lodge-gate')
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } })
})

test('the gate server lists the judgment tools and the planner rewind tool', () => {
  const response = handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.deepEqual(response.result.tools.map(tool => tool.name), ['submit_verdict', 'submit_decision', 'submit_plan', 'adjust_member_model', 'ask_decision', 'ask_question', 'rewind_stage', 'stop_round', 'resume_round'])
  assert.equal(GATE_TOOLS[0].inputSchema.required.includes('reason'), true)
})

test('a verdict call echoes a structured result', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: {
        decision: 'REJECT',
        reason: '缺少日志',
        findings: [{ title: '没有运行记录', severity: 'major', check: 'npm test 会因为没有日志失败' }],
      },
    },
  })
  assert.equal(response.result.isError, undefined)
  assert.equal(response.result.structuredContent.decision, 'REJECT')
  assert.equal(response.result.structuredContent.reason, '缺少日志')
})

test('a REJECT without a checked blocker is refused', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: {
        decision: 'REJECT',
        reason: '有几个小问题',
        findings: [{ title: '命名可以更好', severity: 'minor' }],
      },
    },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /带 check 的 blocker\/major/)
})

test('a verdict can cite the platform visual check', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 31,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: { decision: 'PASS', reason: '画面层次正常', outsideDiff: '无', visual: { seen: false }, coverage: [{ item: '画面层次正常', evidence: '看了平台截图和像素检查' }] },
    },
  })
  assert.deepEqual(response.result.structuredContent.visual, { seen: false })
})

test('a verdict cannot attach numbers while claiming it did not see', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: { decision: 'PASS', reason: '画面层次正常', outsideDiff: '无', visual: { seen: false, colors: 50, contrast: 255 }, coverage: [{ item: '画面层次正常', evidence: '看了平台截图和像素检查' }] },
    },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /seen:false/)
})

test('a PASS without an outside-diff risk is refused', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 33,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'PASS', reason: '都过了' } },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /diff 之外/)
})

test('a PASS without a coverage table is refused', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 35,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'PASS', reason: '都过了', outsideDiff: '无' } },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /coverage/)
  const incomplete = handleMessage({
    jsonrpc: '2.0',
    id: 36,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: { decision: 'PASS', reason: '都过了', outsideDiff: '无', coverage: [{ item: '目标可以跑' }] },
    },
  })
  assert.equal(incomplete.result.isError, true)
})

test('a PASS echoes the outside-diff risk', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 34,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'PASS', reason: '都过了', outsideDiff: '并发下没有锁', coverage: [{ item: '目标可以跑', evidence: '运行了 npm test' }] } },
  })
  assert.equal(response.result.structuredContent.outsideDiff, '并发下没有锁')
})

test('a malformed visual field is refused', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 32,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'PASS', reason: 'x', outsideDiff: '无', visual: { colors: 3 }, coverage: [{ item: 'x', evidence: '读了文件' }] } },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /seen/)
})

test('an invalid verdict is refused without breaking the connection', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'submit_verdict', arguments: { decision: 'MAYBE', reason: 'x' } },
  })
  assert.equal(response.result.isError, true)
  assert.match(response.result.content[0].text, /PASS \/ REJECT/)
})

test('a Chinese verdict maps to the tool decision', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 41,
    method: 'tools/call',
    params: {
      name: 'submit_verdict',
      arguments: {
        decision: '不通过',
        reason: '缺测试',
        findings: [{ title: '缺测试', severity: 'major', check: 'npm test 没有覆盖新分支' }],
      },
    },
  })
  assert.equal(response.result.isError, undefined)
  assert.equal(response.result.structuredContent.decision, 'REJECT')
})

test('a plan needs a stage, an executor and a verifier', () => {
  const ok = handleMessage({
    jsonrpc: '2.0', id: 500, method: 'tools/call',
    params: { name: 'submit_plan', arguments: {
      contract: { outcomes: [{ id: 'run', statement: '能跑', observable: '命令退出码为 0' }] },
      plan: { stages: [{ title: '实现', clauseIds: ['run'] }] },
      crew: { executors: [{ engine: 'claude-cli', model: 'x' }], verifiers: [{ engine: 'pi', model: 'y' }] },
    } },
  })
  assert.equal(ok.result.isError, undefined)
  assert.equal(ok.result.structuredContent.kind, 'plan')
  const missing = handleMessage({
    jsonrpc: '2.0', id: 501, method: 'tools/call',
    params: { name: 'submit_plan', arguments: { plan: { done: ['x'], stages: [{ title: 'a' }] }, crew: { executors: [] } } },
  })
  assert.equal(missing.result.isError, true)
})

test('a planner decision accepts the Chinese anchor', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 5,
    method: 'tools/call',
    params: { name: 'submit_decision', arguments: { decision: '交给人', reason: '权限只能你定' } },
  })
  assert.equal(response.result.structuredContent.decision, 'human')
})

test('a planner decision can carry structured human options', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 6,
    method: 'tools/call',
    params: {
      name: 'submit_decision',
      arguments: {
        decision: 'human',
        reason: '两条路都能收，你定',
        options: [
          { id: 'accept', title: '接受当前版本', detail: '写清未证实项', action: 'accept' },
          { id: 'retry', title: '补齐材料', detail: '再查一次', action: 'rework' },
        ],
      },
    },
  })
  assert.equal(response.result.structuredContent.options.length, 2)
  assert.equal(response.result.structuredContent.options[0].action, 'accept')
  assert.equal(response.result.structuredContent.options[1].action, 'rework')
})

test('a planner can ask to rewind a stage by number', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 51,
    method: 'tools/call',
    params: { name: 'rewind_stage', arguments: { stage: 2, note: '用户说第二步方向错了' } },
  })
  assert.equal(response.result.structuredContent.stage, 2)
  assert.equal(response.result.structuredContent.note, '用户说第二步方向错了')
})

test('a planner can stop the round with a reason', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 52,
    method: 'tools/call',
    params: { name: 'stop_round', arguments: { reason: '用户说停下' } },
  })
  assert.equal(response.result.structuredContent.ok, true)
  assert.equal(response.result.structuredContent.reason, '用户说停下')
  const empty = handleMessage({
    jsonrpc: '2.0',
    id: 53,
    method: 'tools/call',
    params: { name: 'stop_round', arguments: { reason: '  ' } },
  })
  assert.equal(empty.result.isError, true)
})

test('a planner can resume a stopped round', () => {
  const response = handleMessage({
    jsonrpc: '2.0',
    id: 54,
    method: 'tools/call',
    params: { name: 'resume_round', arguments: {} },
  })
  assert.equal(response.result.structuredContent.ok, true)
})

test('notifications are silent and unknown methods get an error', () => {
  assert.equal(handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null)
  const response = handleMessage({ jsonrpc: '2.0', id: 6, method: 'nope' })
  assert.equal(response.error.code, -32601)
})

test('ask_decision returns a structured card and rejects a bad recommendation', () => {
  const valid = handleMessage({
    jsonrpc: '2.0', id: 20, method: 'tools/call',
    params: { name: 'ask_decision', arguments: {
      question: '走哪条路？', reason: '会影响结果',
      options: [
        { id: 'keep-local', title: '保留本地', effect: '不覆盖刚改的内容' },
        { id: 'take-remote', title: '用远端', effect: '当前页回到远端版本' },
      ],
      recommended: 'keep-local',
    } },
  })
  assert.equal(valid.result.structuredContent.decision.options.length, 2)
  assert.equal(valid.result.structuredContent.decision.recommended, 'keep-local')
  const bad = handleMessage({
    jsonrpc: '2.0', id: 21, method: 'tools/call',
    params: { name: 'ask_decision', arguments: {
      question: '走哪条路？', reason: '会影响结果',
      options: [{ id: 'a', title: 'A', effect: 'A 的结果' }, { id: 'b', title: 'B', effect: 'B 的结果' }],
      recommended: 'missing',
    } },
  })
  assert.equal(bad.result.isError, true)
})

test('ask_question carries exactly one question and refuses an empty one', () => {
  const valid = handleMessage({
    jsonrpc: '2.0', id: 22, method: 'tools/call',
    params: { name: 'ask_question', arguments: { question: '上次说的版式是哪一版？' } },
  })
  assert.equal(valid.result.isError, undefined)
  assert.equal(valid.result.structuredContent.kind, 'question')
  assert.equal(valid.result.structuredContent.question, '上次说的版式是哪一版？')
  const bad = handleMessage({
    jsonrpc: '2.0', id: 23, method: 'tools/call',
    params: { name: 'ask_question', arguments: { question: '  ' } },
  })
  assert.equal(bad.result.isError, true)
})
