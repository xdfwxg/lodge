// 工作室的业务命令目录：谁、在什么房间状态、对哪种阶段做什么，只在这里写一遍。
// 入口（人、规划师、验收回合）只负责取参数和写副作用，状态/角色判断都问这张表。
// 拒绝必须带原因；同一个原因不换词，产品文案按命令写在这张表里。
import { ROOM_STATE, ROUND_STATUS, STAGE_STATE } from './states.js'

export const COMMAND_BY = Object.freeze({ YOU: 'you', LEAD: 'lead', SYSTEM: 'system' })

const ACTIVE = [STAGE_STATE.active]
const DELIVERABLE = ['deliverable']
const DECISION = ['decision']

// transition 只描述“允许之后状态怎么变”，给矩阵测试和模拟器用；真正的副作用还在入口里。
export const STUDIO_COMMANDS = Object.freeze([
  {
    id: 'submit_plan',
    by: [COMMAND_BY.LEAD],
    room: [ROOM_STATE.active],
    kind: DECISION,
    state: ACTIVE,
    transition: { stage: STAGE_STATE.passed },
    copy: { missing: '没有这一步', kind: '这里不是收方案的一步', state: '这一步不在等方案', room: '先让房间继续，再提交方案', role: '只有规划师能提交方案' },
  },
  {
    id: 'verify',
    by: [COMMAND_BY.YOU],
    room: [ROOM_STATE.active],
    kind: DELIVERABLE,
    state: ACTIVE,
    transition: {},
    copy: { missing: '没有这一步', kind: '这个阶段不是交付型', state: '这个阶段不在待验收状态', room: '这一轮已经结束，不能再发起复核', role: '只有人能发起复核' },
  },
  {
    id: 'accept',
    by: [COMMAND_BY.YOU, COMMAND_BY.SYSTEM],
    room: [ROOM_STATE.active],
    kind: ['deliverable', 'decision'],
    state: ACTIVE,
    // 签掉这一步；下一步（如果有）接着开始。
    transition: { stage: STAGE_STATE.passed, next: STAGE_STATE.active },
    copy: { missing: '没有这一步', kind: '这一步不能签收', state: '这一步已经不在等你确认了', room: '先让房间继续，再确认这一步', role: '这一步不能由这个身份确认' },
  },
  {
    id: 'rework',
    by: [COMMAND_BY.YOU],
    room: [ROOM_STATE.active],
    kind: DELIVERABLE,
    state: ACTIVE,
    transition: {},
    copy: { missing: '没有这一步', kind: '这一步不能重做', state: '这一步现在不需要重做', room: '先让房间继续，再重做这一步', role: '只有人能要求重做' },
  },
  {
    id: 'retry',
    by: [COMMAND_BY.YOU],
    room: [ROOM_STATE.active],
    kind: DELIVERABLE,
    state: ACTIVE,
    transition: {},
    copy: { missing: '没有这一步', kind: '这一步不能重试', state: '这一步现在不需要重试', room: '先让房间继续，再重试这一分支', role: '只有人能要求重试' },
  },
  {
    id: 'rewind',
    by: [COMMAND_BY.YOU, COMMAND_BY.LEAD],
    room: [ROOM_STATE.active],
    kind: ['deliverable', 'decision'],
    state: [STAGE_STATE.active, STAGE_STATE.passed],
    // 退回这一步；后面的步骤全部重来。
    transition: { stage: STAGE_STATE.active, after: STAGE_STATE.pending },
    copy: { missing: '没有这一步', kind: '只有步骤能退回', state: '这一步还没开始，不能退回', room: '先让房间继续，再退回这一步', role: '这一步不能由这个身份退回' },
  },
  {
    id: 'resolve_merge',
    by: [COMMAND_BY.YOU],
    room: [ROOM_STATE.active],
    kind: DELIVERABLE,
    state: ACTIVE,
    requires: 'merge-conflict',
    transition: {},
    copy: { missing: '没有这一步', kind: '这一步不能合并', state: '这一步现在不需要合并', room: '先让房间继续，再合并', role: '只有人能确认合并结果', requires: '这一步没有等你处理的合并冲突' },
  },
  {
    id: 'stop_round',
    by: [COMMAND_BY.LEAD],
    // 停/继续看的是轮次状态：房间本身还在 active，停下的是这一轮。
    round: [ROUND_STATUS.active],
    kind: null,
    state: null,
    transition: { round: ROUND_STATUS.stopped },
    copy: { missing: '', kind: '', state: '', round: '这一轮已经停了', role: '只有规划师能停这一轮' },
  },
  {
    id: 'resume_round',
    by: [COMMAND_BY.LEAD],
    round: [ROUND_STATUS.stopped],
    kind: null,
    state: null,
    transition: { round: ROUND_STATUS.active },
    copy: { missing: '', kind: '', state: '', round: '这一轮没有停着', role: '只有规划师能接着做' },
  },
])

const TABLE = new Map(STUDIO_COMMANDS.map(command => [command.id, command]))

const inList = (list, value) => list === null || list === undefined || list.includes(value)

// 返回 { code, text } 或 null。code 直接给入口当业务错误码（invalid / conflict）。
export const commandRefusal = ({ command, room, by = COMMAND_BY.YOU, stageIndex = null }) => {
  const row = TABLE.get(command)
  if (row === undefined) return { code: 'invalid', text: '没有这个命令' }
  const stage = Number.isInteger(stageIndex) ? room?.stages?.[stageIndex] : null
  if (row.kind !== null && Number.isInteger(stageIndex) && stage === undefined) {
    return { code: 'invalid', text: row.copy.missing }
  }
  if (!row.by.includes(by)) return { code: 'conflict', text: row.copy.role }
  if (row.round !== undefined) {
    const roundStatus = room?.workRound?.status ?? room?.status ?? null
    if (!row.round.includes(roundStatus)) return { code: 'conflict', text: row.copy.round }
  }
  if (row.room !== undefined && !inList(row.room, room?.state)) {
    return { code: 'conflict', text: row.copy.room }
  }
  if (row.kind !== null) {
    // 没有阶段维度的命令（停/继续）不看阶段号，缺一步不算它的错。
    if (stage === null || stage === undefined) return { code: 'invalid', text: row.copy.missing }
    if (!row.kind.includes(stage.kind)) return { code: 'invalid', text: row.copy.kind }
    // 已经过了的阶段对“确认”是幂等成功，由入口自己处理；这里只判断能不能进入。
    if (!row.state.includes(stage.state)) return { code: 'conflict', text: row.copy.state }
  }
  if (row.requires === 'merge-conflict' && room?.mergeConflict?.stage !== stageIndex) {
    return { code: 'conflict', text: row.copy.requires }
  }
  return null
}

// 矩阵与随机序列测试用：把一条被允许的命令落到房间上。
export const applyTransition = ({ command, room, stageIndex = null }) => {
  const row = TABLE.get(command)
  if (row === undefined || room?.stages === undefined) return room
  const next = structuredClone(room)
  if (row.transition.round !== undefined) next.state = row.transition.round
  if (row.transition.stage !== undefined && Number.isInteger(stageIndex)) {
    next.stages[stageIndex].state = row.transition.stage
    if (row.transition.after !== undefined) {
      for (let at = stageIndex + 1; at < next.stages.length; at += 1) {
        next.stages[at].state = row.transition.after
      }
    }
    if (row.transition.next !== undefined) {
      const target = next.stages.findIndex(stage => stage.state === STAGE_STATE.pending)
      if (target >= 0) next.stages[target].state = row.transition.next
    }
  }
  return next
}
