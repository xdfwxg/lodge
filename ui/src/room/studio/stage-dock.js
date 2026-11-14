import { createElement as h, useEffect, useState } from 'react'
import { DemoStep, LiveGate, StageAction } from './stage-controls.js'
import { gateStatus, stageGate, stageNeedsHuman } from './stage-gate.js'

function StageDock({ room, open: controlledOpen, onOpenChange, onAccept, onAnswer, onSimulate, onSetAcceptance, onVerify, onRework }) {
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
    : room.demo === true ? !hasPass : room.live === true && !hasPass
  if (!canAct || !stageNeedsHuman(room, activeIndex)) return null
  const body = activeStage.kind === 'decision'
    ? h(StageAction, { room, stage: activeStage, index: activeIndex, onAccept, onAnswer, onRework })
    : room.demo === true
      ? h(DemoStep, { stage: activeStage, index: activeIndex, onSimulate })
      : h(LiveGate, { room, stage: activeStage, index: activeIndex, onSetAcceptance, onVerify, onAccept, onRework })
  return h('div', { className: 'crew-stage-dock', 'data-open': open },
    h('button', {
      type: 'button',
      className: 'crew-stage-dock-row',
      'aria-expanded': open,
      onClick: () => setOpen(!open),
    },
    h('span', { className: 'crew-stage-dock-kicker' }, `阶段 ${activeIndex + 1}`),
    h('span', { className: 'crew-stage-dock-title' }, activeStage.title),
    h('span', { className: 'crew-stage-dock-badge' }, gateStatus(room)),
    h('span', { className: 'crew-stage-dock-toggle' }, open ? '收起' : '展开')),
    open ? h('div', { className: 'crew-stage-dock-body' }, body) : null)
}

export { StageDock }
