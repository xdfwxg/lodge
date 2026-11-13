// 阶段门的纯投影：只看房间与消息，不依赖 React，方便单独验证。
const HUMAN_GATE_KINDS = new Set(['decision', 'setup', 'rework'])

export const stageNeedsHuman = (room, activeIndex) => {
  const needs = room.needsYou
  return needs !== undefined && needs !== null &&
    needs.stage === activeIndex &&
    (HUMAN_GATE_KINDS.has(needs.kind) ||
      (needs.kind === 'signoff' && (room.verifiers?.length ?? 0) === 0))
}

// 人的返工意见之后，这一阶段的旧证据和旧结论不再算数。
export const reworkFloorOf = (messages, stageIndex) => messages.reduce((floor, message) => (
  message.kind === 'rework' && (message.meta?.stage ?? 0) === stageIndex ? Math.max(floor, message.seq ?? 0) : floor
), -1)

export const stageGate = room => {
  const activeIndex = room.stages.findIndex(stage => stage.state === 'active')
  const activeStage = room.stages[activeIndex]
  const floor = reworkFloorOf(room.messages, activeIndex)
  const hasPass = activeIndex >= 0 && room.messages.some(message => (
    message.kind === 'verdict' && (message.seq ?? 0) > floor && message.meta?.pass === true && message.meta?.stage === activeIndex
  ))
  const manualReady = activeStage?.manual === true && room.messages.some(message => (
    message.kind === 'evidence' && (message.seq ?? 0) > floor && message.meta?.kind === 'manual' && (message.meta?.stage ?? 0) === activeIndex
  ))
  return { activeIndex, activeStage, floor, hasPass, manualReady }
}

export const gateStatus = room => {
  const { activeStage, floor, hasPass, manualReady } = stageGate(room)
  if (activeStage === undefined) return ''
  if (room.state === 'paused') return '已暂停'
  if (room.state === 'stopped') return '已停止'
  if (activeStage.kind === 'decision') {
    if (room.openQuestion) return '等你回答'
    if (activeStage.manual === true && !manualReady && room.live === true) return '等待产出'
    return '等你确认'
  }
  if (room.demo === true) return '演示'
  if (hasPass) return '等你签字'
  const acceptance = typeof activeStage.acceptance === 'string' ? activeStage.acceptance.trim() : ''
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' &&
    (message.seq ?? 0) > floor &&
    message.meta?.kind === 'command' &&
    message.meta?.stage === room.stages.indexOf(activeStage) &&
    message.meta?.command === acceptance
  ))
  if (evidence === undefined) return '等待证据'
  if (evidence.meta?.exit !== 0) return '命令未通过'
  const verdict = [...room.messages].reverse().find(message => (
    message.kind === 'verdict' && message.meta?.stage === room.stages.indexOf(activeStage) && message.meta?.evidenceId === evidence.id
  ))
  return verdict !== undefined && verdict.meta?.pass !== true ? '验收退回' : '等待复核'
}
