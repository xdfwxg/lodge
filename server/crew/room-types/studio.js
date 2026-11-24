import { roleKindOf } from '../roster.js'
import { roomTypeMeta } from '../../../shared/room-types.js'
import { stripAttachmentTags } from '../../../shared/attachments.js'
import { STAGE_STATE } from '../../../shared/states.js'

const meta = roomTypeMeta('studio')

export const id = 'studio'
export const name = meta.name
export const description = meta.description
export const defaultVerify = meta.defaultVerify
export const readOnly = meta.readOnly
export const defaultMembers = null
export const maxChatTurns = null
export const autoStart = 'stage'
export const singleDirectory = true
export const requireWorker = true

// 能力矩阵来自 shared/room-types.js 的产品级房型清单。
export const capabilities = meta.capabilities

export const normalize = ({ verify, acceptance }) => ({ verify, acceptance })

export const briefDone = (room, plan) => {
  if (plan?.done?.length > 0) return plan.done.map(text => `- [ ] ${text}`)
  const stages = Array.isArray(room.stages) ? room.stages : []
  return stages.map((stage, index) => (
    `- [${stage.state === STAGE_STATE.passed ? 'x' : ' '}] 阶段 ${index + 1}：${stage.title}${stage.kind === 'deliverable' ? '（要交结果）' : '（待确认）'}`
  ))
}

export const buildStages = ({ title, plan, verify, acceptance, align, bootstrap = false }) => {
  // 单人规划师启动态：只开「目标对齐」；工作阶段等 submit_plan 之后再由服务端补上。
  if (bootstrap) {
    return {
      stages: [{ title: '目标对齐', kind: 'decision', spine: true, state: STAGE_STATE.active, activatedAt: Date.now() }],
      messages: [],
    }
  }
  const delivery = {
    title: stripAttachmentTags(title).trim() || '这一轮',
    kind: verify === 'test' ? 'deliverable' : 'decision',
    ...(verify === 'test' ? { acceptance } : { manual: true }),
  }
  const planned = Array.isArray(plan?.stages) ? plan.stages : []
  const work = planned.length > 0
    ? planned.map((stage, index) => ({
      title: stage.title,
      kind: stage.kind,
      ...(stage.manual === true ? { manual: true } : {}),
      ...(stage.acceptance ? { acceptance: stage.acceptance } : {}),
      ...(Array.isArray(stage.assignees) && stage.assignees.length > 0 ? { assignees: stage.assignees } : {}),
      ...(Array.isArray(stage.packages) && stage.packages.length > 0 ? { packages: stage.packages } : {}),
      state: index === 0 ? 'active' : 'pending',
    }))
    : [{ ...delivery, state: align && plan === null ? STAGE_STATE.pending : STAGE_STATE.active }]
  const stages = [
    ...(align ? [{ title: '目标对齐', kind: 'decision', spine: true, state: plan !== null ? STAGE_STATE.passed : STAGE_STATE.active }] : []),
    ...work,
    { title: '验收与结论', kind: 'decision', spine: true, state: STAGE_STATE.pending },
  ]
  if (!stages.some(stage => stage.state === STAGE_STATE.active)) {
    const next = stages.find(stage => stage.state === STAGE_STATE.pending)
    if (next !== undefined) next.state = STAGE_STATE.active
  }
  // 阶段开始时间用于丢弃“上一步还没结束时就在跑”的回合，避免把它们记成新一步的证据。
  const activatedAt = Date.now()
  for (const stage of stages) {
    if (stage.state === STAGE_STATE.active) stage.activatedAt = activatedAt
  }
  stages[stages.length - 1].dependsOn = [stages.length - 2]
  return {
    stages,
    messages: [],
  }
}

// 工作室只有三类本质角色；其他岗位名称必须映射到这三类之一，不能再造 observer 之类第四类。
export const validateRoster = (roster, { verify, bootstrap = false } = {}) => {
  const kindOf = member => member.roleKind ?? roleKindOf(member.role)
  const invalid = roster.filter(member => !['planner', 'executor', 'verifier'].includes(kindOf(member)))
  if (invalid.length > 0) {
    throw new Error(`工作室成员只能从规划师/执行官/验收员派生：${invalid.map(member => member.name ?? member.id).join('、')}`)
  }
  if (!roster.some(member => kindOf(member) === 'planner')) throw new Error('工作室需要规划师成员')
  // 启动态只有规划师；验收员由规划师提交的队伍建设出来，不在这里要求。
  if (!bootstrap && !roster.some(member => kindOf(member) === 'verifier')) throw new Error('工作室需要一位验收员')
}
