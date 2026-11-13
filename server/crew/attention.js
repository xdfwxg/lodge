import { pendingApprovals } from './external-actions.js'
import { commandEvidenceFor, manualReviewState, reviewState, reworkFloor, verifierIds } from './verifiers.js'

const activeStageIndex = room => room.stages.findIndex(stage => stage.state === 'active')

const latestForStage = (messages, kind, stage, after = -1) => [...messages]
  .reverse()
  .find(message => (
    message.kind === kind &&
    (message.meta?.stage ?? 0) === stage &&
    (message.seq ?? 0) > after
  ))

// 注意力路由：只在房间真的卡在人这里时返回一个信号；不是未读数。
export const roomNeedsYou = (room, messages = []) => {
  if (room.state === 'active' && pendingApprovals(room).length > 0) {
    return { kind: 'approval', stage: null, label: '等你批准外部动作' }
  }
  if (room.state === 'paused') {
    if (room.pauseReason === 'budget') return { kind: 'budget', stage: null, label: '预算已用尽 · 等你处理' }
    if (room.pauseReason === 'mcp') return { kind: 'mcp', stage: null, label: 'MCP 熔断 · 等你恢复' }
    if (room.pauseReason === 'approval') return { kind: 'approval', stage: null, label: '外部动作审批超时 · 等你处理' }
    return room.idle === true ? { kind: 'idle', stage: null, label: '等你说话' } : null
  }
  if (room.state !== 'active') return null
  const index = activeStageIndex(room)
  if (index < 0) return null
  const stage = room.stages[index]
  const floor = reworkFloor(messages, index)

  if (room.roomType === 'chat') {
    if (room.chatRunning === true) return null
    const conclusion = [...messages].reverse().find(message => (
      message.kind === 'chat_conclusion' && (message.meta?.round ?? 1) === (room.chatRound ?? 1)
    ))
    return conclusion === undefined
      ? { kind: 'idle', stage: index, label: '聊天中断 · 等你处理' }
      : { kind: 'decision', stage: index, label: '等你确认结论' }
  }

  if (typeof room.openQuestion === 'string' && room.openQuestion.trim() !== '') {
    return { kind: 'question', stage: index, label: '等你回答' }
  }
  if (room.busy === true) return null
  if (stage.manual === true) {
    const manual = latestForStage(messages, 'evidence', index, floor)
    if (manual?.meta?.kind !== 'manual') return null
    if (verifierIds(room).length > 0) {
      const outcome = manualReviewState({ room, messages, stageIndex: index })
      if (outcome.state === 'reject') return { kind: 'rework', stage: index, label: '验收退回 · 等你处理' }
      if (outcome.state === 'pending') {
        return { kind: 'review', stage: index, label: `待复核 · 已回报 ${outcome.received}/${outcome.total}` }
      }
      if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '等你签字' }
      return null
    }
    return { kind: 'decision', stage: index, label: '等你验收' }
  }
  if (stage.kind === 'decision') return { kind: 'decision', stage: index, label: '等你确认' }

  if (typeof stage.acceptance !== 'string' || stage.acceptance.trim() === '') {
    return { kind: 'setup', stage: index, label: '等你设验收命令' }
  }
  const dispatch = room.stageDispatch
  if (room.mergeConflict?.stage === index || (dispatch?.stage === index && dispatch?.conflict !== undefined && dispatch?.conflict !== null)) {
    return { kind: 'merge', stage: index, label: '合并冲突 · 等你处理' }
  }
  if (dispatch?.stage === index && dispatch?.stalled === true) {
    return { kind: 'parallel', stage: index, label: '并行执行没有产出 · 等你处理' }
  }
  if (dispatch?.stage === index && dispatch?.timedOut === true) {
    return { kind: 'parallel', stage: index, label: '并行执行超时 · 等你处理' }
  }
  const commandEvidence = commandEvidenceFor(room, messages, index)
  if (commandEvidence !== undefined && commandEvidence.meta?.exit !== 0) {
    return { kind: 'rework', stage: index, label: '验收未通过 · 等你返工' }
  }
  if (verifierIds(room).length > 1) {
    const outcome = reviewState({ room, messages, stageIndex: index })
    if (outcome.state === 'reject') return { kind: 'rework', stage: index, label: '验收退回 · 等你处理' }
    if (outcome.state === 'pass') return { kind: 'signoff', stage: index, label: '等你签字' }
    if (outcome.state === 'pending') {
      return { kind: 'review', stage: index, label: `待复核 · 已回报 ${outcome.received}/${outcome.total}` }
    }
    return null
  }
  const verdict = latestForStage(messages, 'verdict', index, floor)
  if (verdict?.meta?.pass === true) return { kind: 'signoff', stage: index, label: '等你签字' }
  if (verdict !== undefined) return { kind: 'rework', stage: index, label: '验收退回 · 等你处理' }
  if (latestForStage(messages, 'evidence', index, floor) !== undefined) {
    return (room.verifiers?.length ?? 0) > 0
      ? { kind: 'review', stage: index, label: '待复核' }
      : { kind: 'signoff', stage: index, label: '等你签字' }
  }
  return null
}
