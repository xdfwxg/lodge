import assert from 'node:assert/strict'
import test from 'node:test'
import { modeGuidance, skillPrompt, workContract } from './prompt-modes.js'

test('work contracts carry stage discipline, not room identity', () => {
  assert.match(workContract('worker').join('\n'), /不要自己 git commit/)
  assert.match(workContract('verifier').join('\n'), /第一行只写 PASS 或 REJECT/)
  assert.match(workContract('lead').join('\n'), /用户确认前不要派活/)
  assert.deepEqual(workContract('unknown'), [])
})

test('room modes stay isolated', () => {
  assert.deepEqual(modeGuidance({ roomType: 'task' }), [])
  assert.match(modeGuidance({ roomType: 'roundtable' }).join('\n'), /圆桌讨论.*只读/)
  assert.match(modeGuidance({ roomType: 'archive' }).join('\n'), /存档/)
  assert.match(modeGuidance({ roomType: 'task', readOnly: true }).join('\n'), /只读/)
})

test('optional skills are injected as declared bodies, not catalogs', () => {
  assert.deepEqual(skillPrompt([]), [])
  assert.deepEqual(skillPrompt([{ id: 'review', name: '复核', body: '先看证据。' }]), ['技能：复核', '先看证据。'])
  assert.deepEqual(skillPrompt([{ id: 'empty', name: '空', body: '' }]), [])
})

test('optional skill injection has a total budget', () => {
  const skills = [
    { id: 'a', name: 'A', body: 'a'.repeat(10) },
    { id: 'b', name: 'B', body: 'b'.repeat(10) },
  ]
  assert.deepEqual(skillPrompt(skills, 20), ['技能：A', 'a'.repeat(10)])
})
