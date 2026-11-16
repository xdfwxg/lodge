import { resolveAssigneeTokens } from '../../orchestration/index.js'
import * as type from '../../room-types/studio.js'
import { workContract } from '../../prompt-modes.js'
import { roleKindOf } from '../../roster.js'
import { commandEvidenceFor, latestReviewTimeout, manualReviewState, reviewState, reworkFloor, verifierIds } from './verifiers.js'
import { startInitialStage } from './start.js'
import { activeStageReadOnly } from './turn-utils.js'
import { reviewRoomGate } from '../../gate/index.js'
import { buildDelivery } from './delivery.js'
import { activeDispatchAssignments, dispatchFrom, tasksFrom, updateAssignment } from '../../assignments.js'

const latestForStage = (messages, kind, stage, after = -1) => [...messages]
  .reverse()
  .find(message => (
    message.kind === kind &&
    (message.meta?.stage ?? 0) === stage &&
    (message.seq ?? 0) > after
  ))

const studioNeedsYou = (room, messages = []) => {
  const index = (Array.isArray(room.stages) ? room.stages : []).findIndex(stage => stage.state === 'active')
  if (index < 0) return null
  const stage = room.stages[index]
  const floor = reworkFloor(messages, index)

  if (typeof room.openQuestion === 'string' && room.openQuestion.trim() !== '') {
    return { kind: 'question', stage: index, label: '待回答' }
  }
  if (room.busy === true) return null
  const timeout = latestReviewTimeout(messages, index)
  if (timeout !== undefined) {
    const lastVerdict = latestForStage(messages, 'verdict', index, floor)
    if ((timeout.ts ?? 0) > (room.reviewRetriedAt ?? 0) && (timeout.ts ?? 0) > (lastVerdict?.ts ?? 0)) {
      return { kind: 'review-timeout', stage: index, label: '复核超时' }
    }
  }
  if (stage.manual === true) {
    const manual = latestForStage(messages, 'evidence', index, floor)
    if (manual?.meta?.kind !== 'manual') return null
    if (verifierIds(room).length > 0) {
      const outcome = manualReviewState({ room, messages, stageIndex: index })
      if (outcome.state === 'reject') return { kind: 'rework', stage: index, label: '待重做' }
      if (outcome.state === 'pending') {
        return { kind: 'review', stage: index, label: `验收员在看 · 已回 ${outcome.received}/${outcome.total}` }
      }
      if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '待签字' }
      return null
    }
    return { kind: 'decision', stage: index, label: '待确认' }
  }
  if (stage.kind === 'decision') return { kind: 'decision', stage: index, label: '待确认' }

  if (typeof stage.acceptance !== 'string' || stage.acceptance.trim() === '') {
    return { kind: 'setup', stage: index, label: '待补检查' }
  }
  const dispatch = dispatchFrom(room.assignments ?? [], index)
  if (room.mergeConflict?.stage === index || (dispatch?.stage === index && dispatch?.conflict !== undefined && dispatch?.conflict !== null)) {
    return { kind: 'merge', stage: index, label: '合并冲突' }
  }
  if (dispatch?.stage === index && dispatch?.stalled === true) {
    return { kind: 'parallel', stage: index, label: '并行执行无产出' }
  }
  if (dispatch?.stage === index && dispatch?.timedOut === true) {
    return { kind: 'parallel', stage: index, label: '并行执行超时' }
  }
  const commandEvidence = commandEvidenceFor(room, undefined, messages, index)
  if (commandEvidence !== undefined && commandEvidence.meta?.exit !== 0) {
    return { kind: 'rework', stage: index, label: '待重做' }
  }
  if (verifierIds(room).length > 1) {
    const outcome = reviewState({ room, messages, stageIndex: index })
    if (outcome.state === 'reject') return { kind: 'rework', stage: index, label: '待重做' }
    if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '待签字' }
    if (outcome.state === 'pending') {
      return { kind: 'review', stage: index, label: `验收员在看 · 已回 ${outcome.received}/${outcome.total}` }
    }
    return null
  }
  const verdict = latestForStage(messages, 'verdict', index, floor)
  if (verdict?.meta?.pass === true) return { kind: 'signoff', stage: index, label: '待签字' }
  if (verdict !== undefined) return { kind: 'rework', stage: index, label: '待重做' }
  if (latestForStage(messages, 'evidence', index, floor) !== undefined) {
    return verifierIds(room).length > 0
      ? { kind: 'review', stage: index, label: '验收员在看' }
      : { kind: 'signoff', stage: index, label: '待签字' }
  }
  return null
}

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


const studioConstraints = ({
  plan,
  verify,
  acceptance,
  verifiers,
  independence,
}) => [
  plan?.stages?.length > 0
    ? `阶段验收：${plan.stages.filter(stage => stage.acceptance).map(stage => `${stage.title} → ${stage.acceptance}`).join('；') || '人确认'}`
    : verify === 'test' ? `验收命令：${acceptance}` : '验收方式：人确认，不跑命令',
  ...(verifiers.length === 0
    ? ['这个房间没有独立验收成员，由你凭证据签字']
    : [independence === 'vendor'
      ? '执行与验收已绑定不同厂商；验收成员在独立副本里复核'
      : '当前只有同一家模型可用：复核和执行来自同一家，独立复核会打折']),
]

const initialMessages = ({ room, workspaces, engineFallbacks }) => {
  // 时间线只保留会改变用户判断的信息；建房仪式、分支、约束快照、MCP 说明都
  // 能从房间字段和交付卡里查到，不再复述。
  const messages = []
  const label = { lead: '规划师', planner: '规划师', worker: '执行官', executor: '执行官', verifier: '验收员' }
  const envWarnings = Object.entries(workspaces.environment ?? {})
    .flatMap(([member, env]) => (env.warnings ?? []).map(text => `${label[member] ?? member}: ${text}`))
  if (envWarnings.length > 0) messages.push({ kind: 'system', text: `工作文件夹同步警告：${envWarnings.join('；')}` })
  if (Object.keys(engineFallbacks).length > 0) {
    const engineLabel = {
      'claude-cli': 'Claude',
      'codex-cli': 'Codex',
      'grok-cli': 'Grok',
      'kimi-cli': 'Kimi',
      'qwen-cli': '通义千问',
      'deepseek-cli': 'DeepSeek',
      'pi-cli': 'Pi',
      'gemini-cli': 'Gemini',
      claude: 'Claude',
      codex: 'Codex',
      grok: 'Grok',
      kimi: 'Kimi',
      qwen: '通义千问',
      deepseek: 'DeepSeek',
      pi: 'Pi',
      gemini: 'Gemini',
    }
    const text = Object.entries(engineFallbacks)
      .map(([member, item]) => `${label[member] ?? member} 没能用上 ${engineLabel[item.requested] ?? item.requested}，实际跑的是 ${engineLabel[item.actual] ?? item.actual}`)
      .join('；')
    messages.push({
      kind: 'system',
      text: room?.independence === 'vendor'
        ? `${text}。验收仍由另一家模型独立复核，交付卡会按实际模型标注。`
        : `${text}。这次不是独立复核，验收卡会按实际模型标注。`,
    })
  }
  return messages
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
  memberSoul: member => [
    member.prompt,
    '当前是工作室：所有成员在同一个房间目录执行；只有被 @ 的成员才会响应。',
    '你是三类成员之一：规划师、执行官、验收员；不要自创角色，也不要承担其他成员的职责。',
    '所有发给房间的消息都用中文，包括过程说明、进度和中间更新；不要发英文段落。',
    '群消息按角色工作日志格式写；不要把完整日志、diff 或文件内容贴进聊天，细节交给证据。',
    '不要先发“我来/我将/开始检查”之类的准备句或过程声明；直接给工作日志或结论。',
    ...workContract(member.role),
    // 规划师工具协议随 soul 常驻；阶段推进不再专门唤醒规划师。
  ].filter(Boolean).join('\n'),

  validateRoster: type.validateRoster,
  supportsSubrooms: true,
  resolvePlan: (plan, roster) => resolveStageAssignees(plan, roster),
  requiresGate: true,
  evaluateGate: reviewRoomGate,
  supportsDelivery: true,
  acceptsChatDecision: false,
  approvalReadOnly: activeStageReadOnly,
  appliesStageDependencies: true,

  leadMemberIdOf: lead => lead.id,

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
    engine: 'delivery',
    constraints: studioConstraints({ plan, verify, acceptance, verifiers, independence }),
    closure: {
      closure: plan === null ? 'open' : 'planned',
      verificationMode: 'hybrid',
      shadowReview: shadowReview === true,
      ...(gate === null ? {} : { gate }),
    },
    stages: builtStages.stages,
  }),

  initialMessages,

  provisionExtra: async () => null,

  start: startInitialStage,

  needsYou: studioNeedsYou,

  stateOf: room => (room.closure === 'signed' ? 'signed' : room.closure ?? 'open'),

  filterMessages: messages => messages,
  hideActivity: false,
  acceptsDelta: false,

  refresh: () => ({}),


  // 交付卡是工作室投影；共享层只拿结果，不碰阶段与证据结构。
  deliveryOf: (room, messages) => (
    room.state === 'complete' && (room.closure !== undefined || Array.isArray(room.stages))
      ? buildDelivery(room, messages)
      : null
  ),
  hostOf: () => null,
  speakerOf: () => '',

  bulletinAcceptance: room => (room.stages ?? [])
    .map(stage => stage.acceptance)
    .filter(Boolean)
    .join(' / ') || '人确认',

  onMemberFailure: () => {},

  markMemberFailure: (store, room, memberId) => {
    const stageIndex = (room.stages ?? []).findIndex(stage => stage.state === 'active')
    if (stageIndex < 0) return
    for (const assignment of activeDispatchAssignments(store, room.id, stageIndex)) {
      if (assignment.toMemberId !== memberId) continue
      updateAssignment(store, assignment.id, { status: 'failed' })
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

