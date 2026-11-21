import assert from 'node:assert/strict'
import test from 'node:test'
import { deliveryRecord } from './delivery-record.js'

test('the delivery record carries goal, checks, verdicts and files', () => {
  const room = {
    name: '导出交付',
    goal: '在根目录写 hello.txt',
    state: 'idle',
    workRound: { id: 'round-1', status: 'completed' },
    branch: 'crew/x/worker',
    stages: [
      { title: '目标对齐', state: 'passed' },
      { title: '写 hello.txt', state: 'passed', acceptance: 'npm test' },
    ],
    members: [{ id: 'verifier', name: '验收员' }],
    messages: [
      { kind: 'evidence', meta: { kind: 'command', stage: 1, command: 'npm test', exit: 0, changedFiles: ['hello.txt'] } },
      { kind: 'verdict', authorId: 'verifier', text: 'PASS 内容正确', meta: { stage: 1, pass: true } },
    ],
  }
  const text = deliveryRecord(room)
  assert.match(text, /# 导出交付/)
  assert.match(text, /目标：在根目录写 hello\.txt/)
  assert.match(text, /状态：已交付/)
  assert.match(text, /写 hello\.txt — 已完成 · 检查：`npm test`/)
  assert.match(text, /`npm test` → 退出码 0/)
  assert.match(text, /PASS · 验收员 · PASS 内容正确/)
  assert.match(text, /hello\.txt/)
  assert.match(text, /分支：crew\/x\/worker/)
})

test('an unfinished room still reads honestly', () => {
  const text = deliveryRecord({ name: '半成品', goal: '写点东西', state: 'active', stages: [{ title: '写', state: 'active' }] })
  assert.match(text, /状态：进行中/)
  assert.match(text, /没有运行检查/)
  assert.match(text, /没有验收结论/)
})

test('an active next round is not recorded as delivered because of the previous one', () => {
  const text = deliveryRecord({
    name: '下一轮',
    goal: '继续做',
    state: 'active',
    activeRoundId: 'round-2',
    workRound: { id: 'round-2', status: 'active' },
    rounds: [{ id: 'round-1', status: 'completed' }],
    stages: [{ title: '继续', state: 'active' }],
  })
  assert.match(text, /状态：进行中/)
  assert.doesNotMatch(text, /状态：已交付/)
})
