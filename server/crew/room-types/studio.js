import { roleKindOf } from '../roster.js'
import { roomTypeMeta } from '../../../shared/room-types.js'

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
    `- [${stage.state === 'passed' ? 'x' : ' '}] 阶段 ${index + 1}：${stage.title}${stage.kind === 'deliverable' ? '（要交结果）' : '（需要你确认）'}`
  ))
}

export const buildStages = ({ title, plan, verify, acceptance, align }) => {
  const delivery = {
    title,
    kind: verify === 'test' ? 'deliverable' : 'decision',
    ...(verify === 'test' ? { acceptance } : { manual: true }),
  }
  const planned = Array.isArray(plan?.stages) ? plan.stages : []
  const openingGate = planned.length > 0 &&
    planned[0].kind === 'decision' &&
    /确认|对齐/.test(planned[0].title ?? '')
  const firstActive = openingGate ? 1 : 0
  const work = planned.length > 0
    ? planned.map((stage, index) => ({
      title: stage.title,
      kind: stage.kind,
      ...(stage.manual === true ? { manual: true } : {}),
      ...(stage.acceptance ? { acceptance: stage.acceptance } : {}),
      ...(Array.isArray(stage.assignees) && stage.assignees.length > 0 ? { assignees: stage.assignees } : {}),
      state: index === firstActive ? 'active' : index < firstActive ? 'passed' : 'pending',
    }))
    : [{ ...delivery, state: align && plan === null ? 'pending' : 'active' }]
  const stages = [
    ...(align ? [{ title: '目标对齐', kind: 'decision', spine: true, state: plan !== null ? 'passed' : 'active' }] : []),
    ...work,
    { title: '验收与结论', kind: 'decision', spine: true, state: 'pending' },
  ]
  if (!stages.some(stage => stage.state === 'active')) {
    const next = stages.find(stage => stage.state === 'pending')
    if (next !== undefined) next.state = 'active'
  }
  // 阶段开始时间用于丢弃“上一步还没结束时就在跑”的回合，避免把它们记成新一步的证据。
  const activatedAt = Date.now()
  for (const stage of stages) {
    if (stage.state === 'active') stage.activatedAt = activatedAt
  }
  stages[stages.length - 1].dependsOn = [stages.length - 2]
  return {
    stages,
    messages: openingGate ? ['方案已经定了；重复的确认步骤自动通过，直接进入下一步。'] : [],
  }
}

// 工作室只有三类本质角色；其他岗位名称必须映射到这三类之一，不能再造 observer 之类第四类。
export const validateRoster = (roster, { verify } = {}) => {
  const kindOf = member => member.roleKind ?? roleKindOf(member.role)
  const invalid = roster.filter(member => !['planner', 'executor', 'verifier'].includes(kindOf(member)))
  if (invalid.length > 0) {
    throw new Error(`工作室成员只能从规划师/执行官/验收员派生：${invalid.map(member => member.name ?? member.id).join('、')}`)
  }
  if (!roster.some(member => kindOf(member) === 'planner')) throw new Error('工作室需要规划师成员')
  if (!roster.some(member => kindOf(member) === 'verifier')) throw new Error('工作室需要一位验收员')
}
