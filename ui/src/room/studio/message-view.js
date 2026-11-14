import { createElement as h } from 'react'
import { renderSharedMessage, resolveSeat } from '../message-view.js'
import { Baton } from './baton.js'
import { StudioBeat } from './beat.js'
import {
  ConclusionCard,
  EvidenceCard,
  MilestoneLine,
  VerdictCard,
} from './cards.js'
import { isDispatchHandoff } from './handoff.js'

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
  if (message.kind === 'dispatch') return h(Baton, { key: message.id, message, room, byId })
  if (message.kind === 'stage_conclusion') return h(MilestoneLine, { key: message.id, message })
  if (message.kind === 'evidence') return h(EvidenceCard, { key: message.id, message, seat })
  if (message.kind === 'conclusion') return h(ConclusionCard, { key: message.id, message })
  if (message.kind === 'verdict') {
    return h(VerdictCard, {
      key: message.id,
      message,
      seat,
      room,
      stage: room.stages[message.meta?.stage ?? 0],
      onAccept: onStageAccept === null ? undefined : onStageAccept ?? onAccept,
      evidence: timeline.evidenceFor.get(message.id),
    })
  }
  // 席位发言在工作室里是一拍工作记录：第一段可见，完整内容展开。
  if (message.kind === 'chat' && message.authorId !== 'you') {
    return h(StudioBeat, { key: message.id, message, seat })
  }
  return renderSharedMessage({ room, byId, message })
}
