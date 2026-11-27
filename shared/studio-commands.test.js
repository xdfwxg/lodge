import assert from 'node:assert/strict'
import test from 'node:test'
import { COMMAND_BY, STUDIO_COMMANDS, commandRefusal } from './studio-commands.js'

const stage = (kind, state) => ({ kind, state })
const room = ({ state = 'active', stages = [], mergeConflict = null, round = null } = {}) => ({
  state,
  stages,
  mergeConflict,
  ...(round === null ? {} : { workRound: { status: round } }),
})

const ALLOW = 'allow'

// 期望表：每一行就是一条业务决定；改规则必须先改这里。
const EXPECTED = [
  // 命令, 身份, 房间, 阶段, 期望（allow 或拒绝原因的片段）
  ['submit_plan', COMMAND_BY.LEAD, room({ stages: [stage('decision', 'active')] }), 0, ALLOW],
  ['submit_plan', COMMAND_BY.YOU, room({ stages: [stage('decision', 'active')] }), 0, '只有规划师'],
  ['submit_plan', COMMAND_BY.LEAD, room({ state: 'paused', stages: [stage('decision', 'active')] }), 0, '先让房间继续'],
  ['submit_plan', COMMAND_BY.LEAD, room({ stages: [stage('deliverable', 'active')] }), 0, '不是收方案'],
  ['submit_plan', COMMAND_BY.LEAD, room({ stages: [stage('decision', 'passed')] }), 0, '不在等方案'],

  ['verify', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active')] }), 0, ALLOW],
  ['verify', COMMAND_BY.LEAD, room({ stages: [stage('deliverable', 'active')] }), 0, '只有人'],
  ['verify', COMMAND_BY.YOU, room({ stages: [stage('decision', 'active')] }), 0, '不是交付型'],
  ['verify', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'passed')] }), 0, '不在待验收'],
  ['verify', COMMAND_BY.YOU, room({ state: 'idle', stages: [stage('deliverable', 'active')] }), 0, '不能再发起复核'],

  ['accept', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active')] }), 0, ALLOW],
  ['accept', COMMAND_BY.SYSTEM, room({ stages: [stage('decision', 'active')] }), 0, ALLOW],
  ['accept', COMMAND_BY.LEAD, room({ stages: [stage('deliverable', 'active')] }), 0, '不能由这个身份'],
  ['accept', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'passed')] }), 0, '不在等你确认'],
  ['accept', COMMAND_BY.YOU, room({ state: 'paused', stages: [stage('deliverable', 'active')] }), 0, '先让房间继续'],

  ['rework', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active')] }), 0, ALLOW],
  ['rework', COMMAND_BY.LEAD, room({ stages: [stage('deliverable', 'active')] }), 0, '只有人'],
  ['rework', COMMAND_BY.YOU, room({ stages: [stage('decision', 'active')] }), 0, '不能重做'],
  ['rework', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'passed')] }), 0, '不需要重做'],

  ['retry', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active')] }), 0, ALLOW],
  ['retry', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'pending')] }), 0, '不需要重试'],

  ['rewind', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active'), stage('decision', 'pending')] }), 0, ALLOW],
  ['rewind', COMMAND_BY.LEAD, room({ stages: [stage('deliverable', 'passed')] }), 0, ALLOW],
  ['rewind', COMMAND_BY.SYSTEM, room({ stages: [stage('deliverable', 'active')] }), 0, '不能由这个身份'],
  ['rewind', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'pending')] }), 0, '还没开始'],

  ['resolve_merge', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active')], mergeConflict: { stage: 0 } }), 0, ALLOW],
  ['resolve_merge', COMMAND_BY.YOU, room({ stages: [stage('deliverable', 'active')] }), 0, '没有等你处理的合并冲突'],

  ['stop_round', COMMAND_BY.LEAD, room({ round: 'active' }), null, ALLOW],
  ['stop_round', COMMAND_BY.LEAD, room({ round: 'stopped' }), null, '已经停了'],
  ['stop_round', COMMAND_BY.YOU, room({ round: 'active' }), null, '只有规划师'],
  ['resume_round', COMMAND_BY.LEAD, room({ round: 'stopped' }), null, ALLOW],
  ['resume_round', COMMAND_BY.LEAD, room({ round: 'active' }), null, '没有停着'],
]

test('the command matrix allows exactly the documented transitions', () => {
  for (const [command, by, target, index, expected] of EXPECTED) {
    const refusal = commandRefusal({ command, room: target, by, stageIndex: index })
    if (expected === ALLOW) {
      assert.equal(refusal, null, `${command} / ${by} should be allowed`)
      continue
    }
    assert.ok(refusal !== null, `${command} / ${by} should be refused`)
    assert.match(refusal.text, new RegExp(expected), `${command} / ${by} refusal names the reason`)
    assert.ok(['invalid', 'conflict'].includes(refusal.code))
  }
})

test('every command in the catalog has at least one allowed row and one refused row', () => {
  for (const command of STUDIO_COMMANDS) {
    const rows = EXPECTED.filter(([id]) => id === command.id)
    assert.ok(rows.some(row => row[4] === ALLOW), `${command.id} has an allowed case`)
    assert.ok(rows.some(row => row[4] !== ALLOW), `${command.id} has a refused case`)
  }
  // 反过来：期望表不能写一个目录里没有的命令。
  for (const [id] of EXPECTED) assert.ok(STUDIO_COMMANDS.some(command => command.id === id), `${id} exists in the catalog`)
})

test('an unknown command is refused instead of silently doing nothing', () => {
  const refusal = commandRefusal({ command: 'delete_everything', room: room({}), by: COMMAND_BY.YOU, stageIndex: 0 })
  assert.deepEqual(refusal, { code: 'invalid', text: '没有这个命令' })
})
