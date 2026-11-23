import { resolveAssigneeTokens } from '../../orchestration/index.js'
import * as type from '../../room-types/studio.js'
import { workContract } from '../../prompt-modes.js'
import { roleKindOf } from '../../roster.js'
import { startInitialStage } from './start.js'
import { activeStageReadOnly } from './turn-utils.js'
import { reviewRoomGate } from '../../gate/index.js'
import { buildDelivery } from './delivery.js'
import { studioIssuesOf, studioRetroOf } from './issues.js'
import { studioNeedsYou } from './needs.js'
import { initialMessages, studioConstraints } from './record.js'
import { SHADOW_SOUL } from './shadow-reviewer.js'
import { activeDispatchAssignments, transitionAssignment } from '../../assignments.js'
import { tasksFrom } from '../../assignment-projections.js'
import { ROUND_STATUS, STAGE_STATE } from '../../../../shared/states.js'

const resolveStageAssignees = (plan, roster) => {
  if (plan === null || !Array.isArray(plan.stages)) return plan
  return {
    ...plan,
    stages: plan.stages.map(stage => {
      const { assignees, ...rest } = stage
      const resolved = resolveAssigneeTokens(assignees, roster)
      return resolved.length > 0 ? { ...rest, assignees: resolved } : rest
    }),
  }
}


export const studioKind = {
  id: 'studio',
  type,
  owns: typeId => typeId === 'studio',

  memberRole: member => ({
    roleKind: member.roleKind ?? roleKindOf(member.role),
    roleProfile: member.name,
  }),

  // 静态纪律只注入一次，后续阶段提示不再重复。
  memberSoul: member => {
    const prompt = member.prompt ?? ''
    // 默认提示已经写了工具协议时不再重复；自定义提示仍由系统规则兜底。
    const gateTools = ['lodge_gate_ask_decision', 'lodge_gate_ask_question', 'lodge_gate_stop_round', 'lodge_gate_resume_round']
    const rules = workContract(member.role).filter(line => {
      const tool = gateTools.find(name => line.includes(name))
      return tool === undefined || !prompt.includes(tool)
    })
    return [
      prompt,
      '当前是工作室：你和其他成员在同一个房间，知道彼此的存在和能力。系统负责把完整任务送到、记账和兜底。',
      '不要自创角色，也不要承担其他成员的职责。',
      '没轮到你时不用应答；等系统派活或别人明确 @ 你，再说话。',
      '所有发给房间的消息都用中文，包括过程说明、进度和中间更新；不要发英文段落。',
      '群消息像给同事发消息一样说人话；不要把完整日志、diff 或文件内容贴进聊天，细节交给证据。',
      '**加粗**只给会影响决定的信息：结论、下一步、完成标准、文件名或路径、风险、需要人做的事；次要说明不加粗，也不要用行内代码包中文标签。',
      '不要先发“我来/我将/开始检查”之类的准备句，也不要写小标题；直接说结果或结论。',
      ...rules,
    ].filter(Boolean).join('\n')
  },

  memberPrompt: member => member.prompt ?? '',
  demoMessage: null,
  validateRoster: type.validateRoster,
  supportsMemberAdd: true,
  allowsHostOnly: () => false,
  busyNow: () => false,
  resolvePlan: (plan, roster) => resolveStageAssignees(plan, roster),
  requiresGate: true,
  evaluateGate: reviewRoomGate,
  supportsDelivery: true,
  approvalReadOnly: activeStageReadOnly,
  appliesStageDependencies: true,

  leadMemberIdOf: lead => lead.id,

  // 对齐回合基座群聊里只留规划师；作答或开始派活后再把全员放回。
  chatMembersOf: room => {
    const first = room.stages?.[0]
    const lead = (room.members ?? []).find(member => member.role === 'lead')
    if (lead !== undefined && first?.title === '目标对齐' && first.state !== STAGE_STATE.passed) return [lead.id]
    return (room.members ?? []).map(member => member.id)
  },

  record: ({
    lead,
    plan,
    verify,
    acceptance,
    verifiers,
    independence,
    shadowReview,
    gate,
    builtStages,
  }) => ({
    constraints: studioConstraints({ plan, verify, acceptance, verifiers, independence }),
    verificationMode: 'hybrid',
    shadowReview: shadowReview === true,
    ...(gate === null ? {} : { gate }),
    stages: builtStages.stages,
  }),

  initialMessages,

  provisionExtra: async ({ host: hostPort, short }) => {
    // 影子评审是房间里的隐藏成员：不占席位、没有工具，只在需要时给一份对照意见。
    const created = await hostPort.createHost({
      name: `影子评审${short}`,
      soul: SHADOW_SOUL,
      approval: 'ask',
    })
    return {
      members: [created.id],
      shadowBot: { memberRef: created.id, name: created.name },
      cleanup: () => hostPort.retireHost(created.id),
    }
  },

  start: startInitialStage,

  needsYou: studioNeedsYou,

  filterMessages: messages => messages,
  hideActivity: false,
  acceptsDelta: false,

  refresh: () => ({}),


  // 交付卡是工作室投影；共享层只拿结果，不碰阶段与证据结构。
  deliveryOf: (room, messages) => (
    room.workRound?.status === ROUND_STATUS.completed &&
    Array.isArray(room.stages)
      ? buildDelivery(room, messages)
      : null
  ),
  hostOf: () => null,
  speakerOf: () => '',
  issuesOf: studioIssuesOf,
  retroOf: studioRetroOf,

  bulletinAcceptance: room => (room.stages ?? [])
    .map(stage => stage.acceptance)
    .filter(Boolean)
    .join(' / ') || '人确认',

  markMemberFailure: (store, room, memberId) => {
    const stageIndex = (room.stages ?? []).findIndex(stage => stage.state === STAGE_STATE.active)
    if (stageIndex < 0) return
    for (const assignment of activeDispatchAssignments(store, room.id, stageIndex)) {
      if (assignment.toMemberId !== memberId) continue
      transitionAssignment(store, assignment.id, 'failed')
    }
  },

  // 阶段任务与派发状态是 Assignment 的投影；共享层只拿结果，不碰阶段结构。
  projectWork: (room, assignments) => {
    if (!Array.isArray(assignments) || assignments.length === 0) return null
    const nameOf = id => (room.members ?? []).find(member => member.id === id)?.name ?? id
    return {
      stages: (room.stages ?? []).map((stage, index) => ({ ...stage, tasks: tasksFrom(assignments, index, nameOf) })),
    }
  },
}

