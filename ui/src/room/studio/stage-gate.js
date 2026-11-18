// 阶段门的纯投影：只看房间与消息，不依赖 React，方便单独验证。
import { reworkFloor } from '../../../../shared/attempt.js'
import { verdictPassed } from '../../../../shared/judgment.js'
import { humanGateActionsOf } from '../../../../shared/human-gate.js'

const HUMAN_GATE_KINDS = new Set(['decision', 'setup', 'rework', 'blocked'])

export const stageNeedsHuman = (room, activeIndex) => {
  const needs = room.needsYou
  const manualStage = room.stages?.[activeIndex]?.manual === true
  return needs !== undefined && needs !== null &&
    needs.stage === activeIndex &&
    (HUMAN_GATE_KINDS.has(needs.kind) ||
      (needs.kind === 'signoff' && ((room.verifiers?.length ?? 0) === 0 || manualStage)))
}

export const stageGate = room => {
  const activeIndex = room.stages.findIndex(stage => stage.state === 'active')
  const activeStage = room.stages[activeIndex]
  const floor = reworkFloor(room.messages, activeIndex)
  const hasPass = activeIndex >= 0 && room.messages.some(message => (
    message.kind === 'verdict' && (message.seq ?? 0) > floor && verdictPassed(message) && message.meta?.stage === activeIndex
  ))
  const manualReady = activeStage?.manual === true && room.messages.some(message => (
    message.kind === 'evidence' && (message.seq ?? 0) > floor && message.meta?.kind === 'manual' && (message.meta?.stage ?? 0) === activeIndex
  ))
  const needs = room.needsYou
  const actions = humanGateActionsOf({
    state: activeStage === undefined ? 'stale' : 'open',
    canPass: hasPass || manualReady,
    canRework: activeStage !== undefined && activeStage.state === 'active' && room.state === 'active',
    canRetry: needs?.kind === 'review-timeout' || needs?.kind === 'auto-check',
    canContinue: room.state === 'paused',
    canManualPass: manualReady,
    canRewind: activeStage !== undefined && (activeStage.kind === 'deliverable' || activeStage.manual === true),
    canNoRetry: needs?.kind === 'rework' || needs?.kind === 'auto-check',
  })
  return { activeIndex, activeStage, floor, hasPass, manualReady, actions }
}

export const gateStatus = room => {
  const { activeIndex, activeStage, floor, hasPass, manualReady } = stageGate(room)
  if (activeStage === undefined) return ''
  if (room.state === 'paused') return '已暂停'
  if (room.state === 'stopped') return '已停止'
  if (activeStage.kind === 'decision') {
    if (room.openQuestion) return '待回答'
    if (activeStage.manual === true) {
      if (!manualReady) return room.live === true ? '等结果' : '待确认'
      if ((room.verifiers?.length ?? 0) > 0) {
        const evidence = [...room.messages].reverse().find(message => (
          message.kind === 'evidence' &&
          (message.seq ?? 0) > floor &&
          (message.meta?.stage ?? 0) === activeIndex &&
          message.meta?.kind === 'manual'
        ))
        if (evidence === undefined) return '等结果'
        const verdicts = room.messages.filter(message => (
          message.kind === 'verdict' &&
          (message.meta?.stage ?? 0) === activeIndex &&
          (message.seq ?? 0) > (evidence.seq ?? -1) &&
          message.meta?.evidenceId === evidence.id
        ))
        if (verdicts.some(message => message.meta?.pass !== true)) return '退回了'
        if (verdicts.length < (room.verifiers?.length ?? 0)) return '验收员在看'
        return '待签字'
      }
      return '待确认'
    }
    return '待确认'
  }
  if (room.demo === true) return '示例'
  if (hasPass) return '待签字'
  const acceptance = typeof activeStage.acceptance === 'string' ? activeStage.acceptance.trim() : ''
  const evidence = [...room.messages].reverse().find(message => (
    message.kind === 'evidence' &&
    (message.seq ?? 0) > floor &&
    message.meta?.kind === 'command' &&
    message.meta?.stage === room.stages.indexOf(activeStage) &&
    message.meta?.command === acceptance
  ))
  if (evidence === undefined) return '等检查结果'
  if (evidence.meta?.exit !== 0) return '检查没通过'
  const verdict = [...room.messages].reverse().find(message => (
    message.kind === 'verdict' && message.meta?.stage === room.stages.indexOf(activeStage) && message.meta?.evidenceId === evidence.id
  ))
  return verdict !== undefined && verdict.meta?.pass !== true ? '退回了' : '验收员在看'
}
