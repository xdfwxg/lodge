import { Fragment, createElement as h } from 'react'
import { renderSharedMessage, resolveSeat } from '../message-view.js'
import { Baton } from './baton.js'
import { StudioBeat } from './beat.js'
import {
  ConclusionCard,
  EvidenceCard,
  MilestoneLine,
  VerdictCard,
} from './cards.js'
import { DecisionBrief, parseDecisionItems } from './decision-brief.js'
import { isDispatchHandoff } from './handoff.js'
import { ShadowCard } from './shadow-card.js'

// 工作室先接管自己的消息类型，其余交给共享渲染器。
export const renderStudioMessage = ({
  room,
  byId,
  message,
  timeline,
  onAccept,
  onStageAccept,
}) => {
  // 人工签字已有系统行；不再复制一张验收员样式的卡。
  if (message.kind === 'verdict' && message.meta?.human === true) return null
  if (isDispatchHandoff(room, message)) return h(Baton, { key: message.id, message, room, byId })
  const seat = resolveSeat(room, byId, message)
  if (message.kind === 'dispatch' || message.kind === 'handoff') return h(Baton, { key: message.id, message, room, byId })
  if (message.kind === 'stage_conclusion') return h(MilestoneLine, { key: message.id, message })
  if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
  if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
  if (message.kind === 'verdict') {
    return h(Fragment, { key: message.id },
      h(VerdictCard, {
        message,
        seat,
        room,
        stage: room.stages[message.meta?.stage ?? 0],
        onAccept: onStageAccept === null ? undefined : onStageAccept ?? onAccept,
        evidence: timeline.evidenceFor.get(message.id),
      }),
      h(ShadowCard, { room, message, byId }))
  }
  // 席位发言在工作室里是一拍工作记录：第一段可见，完整内容展开。
  // 主席位给出两三条要确认的事时，直接变成决策卡，不把整段聊天铺在首屏。
  if (message.kind === 'chat' && message.authorId !== 'you') {
    const isLead = message.authorId === room.leadSeat
    const pending = room.needsYou?.kind === 'decision' && isLead
    const items = isLead ? parseDecisionItems(message.text) : []
    if (items.length >= 2) {
      const active = Array.isArray(room.stages)
        ? room.stages.findIndex(stage => stage.state === 'active')
        : -1
      const accept = onStageAccept ?? onAccept
      return h(DecisionBrief, {
        key: message.id,
        message,
        seat,
        items,
        pending,
        disabled: room.state !== 'active',
        onAccept: pending && typeof accept === 'function' && active >= 0
          ? () => accept(active)
          : undefined,
      })
    }
    return h(StudioBeat, { key: message.id, message, seat, open: pending })
  }
  return renderSharedMessage({ room, byId, message })
}
