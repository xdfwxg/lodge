// 工作室的状态守卫：状态是事实的投影，写入前对照事实和结构。
// 现在是影子模式（只记诊断，不拦）；影子一段都干净后，再把 strict 打开。

import { APPROVAL_STATE, ROOM_STATE, ROUND_STATUS, STAGE_STATE } from '../../../../../shared/states.js'

// stopped 不算终态：停下的一轮可以接回来，进行中的阶段就是接回来的位置。
// 把它当终态会让「停下 → 继续」这条正常路在影子里报一条假告警。
const TERMINAL = new Set([
  ROUND_STATUS.completed,
  ROUND_STATUS.rejected,
  ROUND_STATUS.failed,
  ROUND_STATUS.superseded,
])

const OPEN_ASSIGNMENT = new Set(['created', 'sent', 'working', 'reported'])

// 卡住：交付阶段在做，可没有任何在跑或等人的东西。这类状态不会自己写库，
// 只能靠定期审计发现；它不改变规则，只回答“是不是没人管了”。
export const stuckDeliverableStage = (room, { now = Date.now(), idleMs = 120_000 } = {}) => {
  if (room?.roomType !== 'studio' || room?.state !== ROOM_STATE.active) return null
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const index = stages.findIndex(stage => stage?.kind === 'deliverable' && stage?.state === STAGE_STATE.active)
  if (index < 0) return null
  if (room.blocked?.stage === index) return null
  if (room.mergeConflict?.stage === index) return null
  if (room.pendingDecision?.status === 'open') return null
  const pendingApproval = (room.approvals ?? []).some(item => item?.state === APPROVAL_STATE.pending)
  if (pendingApproval) return null
  const open = (room.assignments ?? []).some(item => item?.stageIndex === index && OPEN_ASSIGNMENT.has(item?.status))
  if (open) return null
  const last = Number(room.lastProgressAt ?? room.workRound?.updatedAt ?? 0)
  if (last > 0 && now - last < idleMs) return null
  return index
}

// 结构不变量：任何写者、任何入口写进来的房间都必须满足。
export const invariantViolations = room => {
  const out = []
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const active = stages.filter(stage => stage?.state === STAGE_STATE.active)
  if (active.length > 1) out.push('同一轮有多个进行中的阶段')
  const status = room?.status ?? room?.workRound?.status ?? ''
  if (TERMINAL.has(String(status)) && active.length > 0) {
    out.push('轮次已经结束，但还有进行中的阶段')
  }
  const planStages = Array.isArray(room?.plan?.stages) ? room.plan.stages : []
  if (planStages.length > 0) {
    const titles = new Set(stages.map(stage => stage?.title))
    for (const stage of planStages) {
      if (typeof stage?.title === 'string' && stage.title !== '' && !titles.has(stage.title)) {
        out.push(`方案阶段「${stage.title}」没有落到轮次状态里`)
      }
    }
  }
  const leads = (room?.members ?? []).filter(member => member?.role === 'lead' || member?.roleKind === 'planner')
  if (leads.length > 1) out.push('房间有多个规划师')
  if (room?.workspace?.capabilities?.desktop === true) {
    const executors = (room?.members ?? []).filter(member => member?.role === 'worker' || member?.roleKind === 'executor')
    if (executors.length > 1) out.push('电脑工作区有多位执行官')
  }
  return out
}

// 影子投影：从消息里的事实推「这一步到底有没有结果/复核对得上」。
// 只查能从事实直接证明的偏差，不复制复核逻辑；先当诊断用。
export const projectionDrift = (room, messages = []) => {
  const drift = []
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const facts = Array.isArray(messages) ? messages : []
  const hasEvidence = index => facts.some(message => (
    message?.kind === 'evidence' && Number(message?.meta?.stage) === index
  ))
  for (const [index, stage] of stages.entries()) {
    if (stage?.kind !== 'deliverable' || stage?.state !== STAGE_STATE.passed) continue
    if (!hasEvidence(index)) {
      drift.push(`第 ${index + 1} 步「${stage.title ?? ''}」已通过，但时间线里没有这一步的结果证据`)
    }
  }
  return drift
}

export const studioFindings = ({ room, messages = [] }) => ({
  violations: invariantViolations(room),
  drift: projectionDrift(room, messages),
})
