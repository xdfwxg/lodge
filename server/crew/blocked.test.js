import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { BLOCKED_REASON } from '../../shared/states.js'
import { BLOCKED_COPY_REASONS, blockedSignalOf } from './blocked.js'

const root = fileURLToPath(new URL('.', import.meta.url))
const walk = dir => readdirSync(dir).flatMap(name => {
  const path = join(dir, name)
  return statSync(path).isDirectory() ? walk(path) : [path]
})

const room = {
  members: [{ id: 'worker', name: '执行官' }],
  blocked: { stage: 0, reason: BLOCKED_REASON.timeout, workers: ['worker'] },
}

test('every stopped reason has exactly one sentence, and the vocabulary has no dead entries', () => {
  assert.deepEqual([...BLOCKED_COPY_REASONS].sort(), Object.values(BLOCKED_REASON).sort())
  assert.equal(blockedSignalOf(room).label, '执行超时：执行官停下了')
  assert.equal(blockedSignalOf({ ...room, blocked: { stage: 0, reason: BLOCKED_REASON.boundary } }).label, '越界改动没能退回')
  assert.equal(blockedSignalOf({ ...room, blocked: { stage: 0, reason: BLOCKED_REASON.plan } }).label, '规划师还没给出方案')
  // 读别人的副本不是等人的停：平台停的是那一位成员。
  assert.equal(blockedSignalOf({ ...room, blocked: { stage: 0, reason: BLOCKED_REASON['read-boundary'] } }), null)
  // 没登记的理由不冒充“执行超时”。
  assert.equal(blockedSignalOf({ ...room, blocked: { stage: 0, reason: 'old-thing' } }).label, '这一步停住了')
  assert.equal(blockedSignalOf({ ...room, blocked: undefined }), null)
})

test('every place that stops a stage uses a reason from the same vocabulary', () => {
  const written = new Set()
  for (const file of walk(root)) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/blocked = \{[\s\S]{0,240}?reason: '([a-z-]+)'/g)) {
      written.add(match[1])
    }
  }
  assert.ok(written.size > 0, '至少要找到一个写 blocked 的地方')
  for (const reason of written) {
    assert.equal(
      Object.values(BLOCKED_REASON).includes(reason),
      true,
      `写的停因 ${reason} 没在 BLOCKED_REASON 里`,
    )
  }
})
