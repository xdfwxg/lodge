import { createElement as h, useEffect, useState } from 'react'
import { ChevronDownIcon } from '../../goal-island/ds-icons.js'
import { LiveGate, StageAction } from './stage-controls.js'
import { gateStatus, stageGate, stageNeedsHuman } from './stage-gate.js'

function StageDock({ room, open: controlledOpen, onOpenChange, onAccept, onAnswer, onSetAcceptance, onVerify, onRework }) {
  const [localOpen, setLocalOpen] = useState(false)
  const open = controlledOpen ?? localOpen
  const setOpen = value => {
    if (onOpenChange === undefined) setLocalOpen(value)
    else onOpenChange(value)
  }
  const { activeIndex, activeStage, hasPass, manualReady } = stageGate(room)
  useEffect(() => {
    if (onOpenChange === undefined) setLocalOpen(false)
    else onOpenChange(false)
  }, [room.id, activeIndex, onOpenChange])
  if (activeStage === undefined) return null
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
