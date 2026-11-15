import { resolveAssigneeTokens } from '../../orchestration/index.js'
import * as type from '../../room-types/studio.js'
import { workContract } from '../../prompt-modes.js'
import { roleKindOf } from '../../seats.js'
import { commandEvidenceFor, latestReviewTimeout, manualReviewState, reviewState, reworkFloor, verifierIds } from './verifiers.js'
import { startInitialStage } from './start.js'
import { activeStageReadOnly } from './turn-utils.js'
import { evaluateRoomGate } from './gate.js'
import { buildDelivery } from './delivery.js'

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
      if (outcome.state === 'reject') return { kind: 'rework', stage: index, label: '待返工' }
      if (outcome.state === 'pending') {
        return { kind: 'review', stage: index, label: `待复核 · 已回报 ${outcome.received}/${outcome.total}` }
      }
      if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '待签字' }
      return null
    }
    return { kind: 'decision', stage: index, label: '待确认' }
  }
  if (stage.kind === 'decision') return { kind: 'decision', stage: index, label: '待确认' }

  if (typeof stage.acceptance !== 'string' || stage.acceptance.trim() === '') {
    return { kind: 'setup', stage: index, label: '待设置' }
  }
  const dispatch = room.stageDispatch
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
    return { kind: 'rework', stage: index, label: '待返工' }
  }
  if (verifierIds(room).length > 1) {
    const outcome = reviewState({ room, messages, stageIndex: index })
    if (outcome.state === 'reject') return { kind: 'rework', stage: index, label: '待返工' }
    if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '待签字' }
    if (outcome.state === 'pending') {
      return { kind: 'review', stage: index, label: `待复核 · 已回报 ${outcome.received}/${outcome.total}` }
    }
    return null
  }
  const verdict = latestForStage(messages, 'verdict', index, floor)
  if (verdict?.meta?.pass === true) return { kind: 'signoff', stage: index, label: '待签字' }
  if (verdict !== undefined) return { kind: 'rework', stage: index, label: '待返工' }
  if (latestForStage(messages, 'evidence', index, floor) !== undefined) {
    return (room.verifiers?.length ?? 0) > 0
      ? { kind: 'review', stage: index, label: '待复核' }
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
    ? ['这个房间没有独立验收席位，由你凭证据签字']
    : [independence === 'vendor'
      ? '执行与验收已绑定不同厂商；验收席位在独立副本里复核'
      : '当前只有同一厂商引擎可用：验收卡会标「独立性降级」']),
]

const initialMessages = ({ workspaces, engineFallbacks }) => {
  // 时间线只保留会改变用户判断的信息；建房仪式、分支、约束快照、MCP 说明都
  // 能从房间字段和交付卡里查到，不再复述。
  const messages = []
  const envWarnings = Object.entries(workspaces.environment ?? {})
    .flatMap(([seat, env]) => (env.warnings ?? []).map(text => `${seat}: ${text}`))
  if (envWarnings.length > 0) messages.push({ kind: 'system', text: `工作区环境同步警告：${envWarnings.join('；')}` })
  if (Object.keys(engineFallbacks).length > 0) {
    const label = { lead: '规划师', planner: '规划师', worker: '执行官', executor: '执行官', verifier: '验收员' }
    const text = Object.entries(engineFallbacks)
      .map(([seat, item]) => `${label[seat] ?? seat} 没能用上 ${item.requested}，实际跑的是 ${item.actual}`)
      .join('；')
    messages.push({
      kind: 'system',
      text: `${text}。这次不是跨厂商复核，验收卡会按实际引擎标注。`,
    })
  }
  return messages
}

export const studioKind = {
  id: 'studio',
  type,
  owns: typeId => typeId === 'studio',

  seatRole: seat => ({
    roleKind: seat.roleKind ?? roleKindOf(seat.role),
    roleProfile: seat.name,
  }),

  // 静态纪律只注入一次，后续阶段提示不再重复。
  seatSoul: seat => [
    seat.prompt,
    '当前是工作室：所有席位在同一个房间目录执行；只有被 @ 的席位才会响应。',
    '你是三类席位之一：规划师、执行官、验收员；不要自创角色，也不要承担其他席位的职责。',
    '所有发给房间的消息都用中文，包括过程说明、进度和中间更新；不要发英文段落。',
    '群消息按角色工作日志格式写；不要把完整日志、diff 或文件内容贴进聊天，细节交给证据。',
    '不要先发“我来/我将/开始检查”之类的准备句或过程声明；直接给工作日志或结论。',
    ...workContract(seat.role),
    // 规划师工具协议随 soul 常驻；阶段推进不再专门唤醒规划师。
  ].filter(Boolean).join('\n'),

  validateRoster: type.validateRoster,
  supportsSubrooms: true,
  resolvePlan: (plan, roster) => resolveStageAssignees(plan, roster),
  requiresGate: true,
  evaluateGate: args => evaluateRoomGate({ enabled: true, ...args }),
  supportsDelivery: true,
  acceptsChatDecision: false,
  approvalReadOnly: activeStageReadOnly,
  appliesStageDependencies: true,

  leadSeatOf: lead => lead.id,

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

  onSeatFailure: (current, seat) => {
    const stageIndex = current.stages?.findIndex(stage => stage.state === 'active') ?? -1
    if (stageIndex < 0 || !Array.isArray(current.stages[stageIndex].tasks)) return
    current.stages[stageIndex].tasks = current.stages[stageIndex].tasks.map(task => (
      task.owner === seat ? { ...task, status: 'failed' } : task
    ))
  },
}

