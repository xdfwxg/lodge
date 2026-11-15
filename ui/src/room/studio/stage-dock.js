import { createElement as h, useEffect, useState } from 'react'
import { ApprovalCard } from '../../approval-card.js'
import { ChevronDownIcon } from '../../goal-island/ds-icons.js'
import { parseDecisionItems } from './decision-brief.js'
import { LiveGate, StageAction } from './stage-controls.js'
import { gateStatus, stageGate, stageNeedsHuman } from './stage-gate.js'

function StageDock({ room, open: controlledOpen, onOpenChange, onAccept, onAnswer, onSetAcceptance, onVerify, onRework, onApproval }) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = value => {
    if (onOpenChange === undefined) setLocalOpen(value)
    else onOpenChange(value)
  }
  const { activeIndex, activeStage, hasPass, manualReady } = stageGate(room)
  const approval = (room.approvals ?? []).find(item => item.state === 'pending')
  useEffect(() => {
    if (onOpenChange === undefined) setLocalOpen(false)
    else onOpenChange(false)
  }, [room.id, activeIndex, onOpenChange])
  // 审批就是一张要你现在决定的卡，不再藏在一行摘要后面。
  if (approval !== undefined) {
    return h('div', { className: 'crew-stage-dock crew-stage-dock-approval' },
      h(ApprovalCard, {
        approval,
        onDecide: decision => onApproval?.(approval.id, decision),
      }))
  }
  if (activeStage === undefined) return null
  // 开工对齐已经有一张带问题的决策卡；底部动作条不再重复同一件事。
  const leadMessage = [...(room.messages ?? [])].reverse().find(message => (
    message.kind === 'chat' && message.authorId === room.leadSeat
  ))
  const openingBrief = activeIndex === 0 &&
    room.needsYou?.kind === 'decision' &&
    leadMessage !== undefined &&
    parseDecisionItems(leadMessage.text).length >= 2
  if (openingBrief) return null
  const canAct = activeStage.kind === 'decision'
    ? activeStage.manual !== true || manualReady
    : room.live === true && !hasPass
  if (!canAct || !stageNeedsHuman(room, activeIndex)) return null
  const body = activeStage.kind === 'decision'
    ? h(StageAction, { room, stage: activeStage, index: activeIndex, onAccept, onAnswer, onRework })
    : h(LiveGate, { room, stage: activeStage, index: activeIndex, onSetAcceptance, onVerify, onAccept, onRework })
  return h('div', { className: 'crew-stage-dock', 'data-open': open },
    h('button', {
      type: 'button',
      className: 'crew-stage-dock-row',
      'aria-expanded': open,
      'aria-label': `阶段 ${activeIndex + 1} ${activeStage.title}，${gateStatus(room)}`,
      onClick: () => setOpen(!open),
    },
    h('span', { className: 'crew-stage-dock-kicker' }, `阶段 ${activeIndex + 1}`),
    h('span', { className: 'crew-stage-dock-title' }, activeStage.title),
    h('span', { className: 'crew-stage-dock-chev', 'data-open': open, 'aria-hidden': 'true' }, h(ChevronDownIcon))),
    open ? h('div', { className: 'crew-stage-dock-body' }, body) : null)
}

export { StageDock }
