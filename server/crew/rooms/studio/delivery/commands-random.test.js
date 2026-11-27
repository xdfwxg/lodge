import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND_BY, STUDIO_COMMANDS, applyTransition, commandRefusal } from '../../../../../shared/studio-commands.js'
import { invariantViolations } from '../runtime/state-guard.js'

// 随机序列：按命令目录随机走路，任何一步之后不变量都不能破；
// 被拒绝的命令必须带原因、且不改状态。固定种子，失败可复现。
const mulberry32 = seed => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const freshRoom = () => ({
  id: 'room-1',
  roomType: 'studio',
  state: 'active',
  members: [
    { id: 'planner', role: 'lead', roleKind: 'planner' },
    { id: 'worker', role: 'worker', roleKind: 'executor' },
  ],
  stages: [
    { title: '对齐', kind: 'decision', state: 'active' },
    { title: '实现', kind: 'deliverable', state: 'pending' },
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ],
})

const ROLES = [COMMAND_BY.YOU, COMMAND_BY.LEAD, COMMAND_BY.SYSTEM]

test('random command sequences never break an invariant, and refusals never mutate the room', () => {
  const random = mulberry32(20261126)
  let room = freshRoom()
  assert.deepEqual(invariantViolations(room), [])
  const refusals = new Map()
  for (let step = 0; step < 400; step += 1) {
    const command = STUDIO_COMMANDS[Math.floor(random() * STUDIO_COMMANDS.length)]
    const by = ROLES[Math.floor(random() * ROLES.length)]
    const stageIndex = Math.floor(random() * (room.stages.length + 1)) - 1
    const before = JSON.stringify(room)
    const refusal = commandRefusal({ command: command.id, room, by, stageIndex })
    if (refusal === null) {
      const next = applyTransition({ command: command.id, room, stageIndex: stageIndex >= 0 ? stageIndex : null })
      assert.deepEqual(invariantViolations(next), [], `${command.id} by ${by} at ${stageIndex} keeps the invariants`)
      room = next
      continue
    }
    assert.ok(typeof refusal.text === 'string' && refusal.text !== '', `${command.id} refusal carries a reason`)
    assert.ok(['invalid', 'conflict'].includes(refusal.code), `${command.id} refusal carries a code`)
    assert.equal(JSON.stringify(room), before, `${command.id} refused by ${by}: state is untouched`)
    refusals.set(refusal.text, (refusals.get(refusal.text) ?? 0) + 1)
  }
  // 随机序列要真的走到过拒绝，否则这条测试只是空的。
  assert.ok(refusals.size > 0, 'the sequence exercised at least one refusal')
})

test('the same sequence replays identically', () => {
  const run = seed => {
    const random = mulberry32(seed)
    let room = freshRoom()
    const trail = []
    for (let step = 0; step < 100; step += 1) {
      const command = STUDIO_COMMANDS[Math.floor(random() * STUDIO_COMMANDS.length)]
      const by = ROLES[Math.floor(random() * ROLES.length)]
      const stageIndex = Math.floor(random() * (room.stages.length + 1)) - 1
      const refusal = commandRefusal({ command: command.id, room, by, stageIndex })
      trail.push(refusal === null ? `${command.id}:ok` : `${command.id}:${refusal.code}`)
      if (refusal === null) room = applyTransition({ command: command.id, room, stageIndex: stageIndex >= 0 ? stageIndex : null })
    }
    return trail.join('|')
  }
  assert.equal(run(7), run(7))
})
