import { createElement as h } from 'react'
import { renderSharedMessage, resolveMember } from '../message-view.js'
import { Baton } from './baton.js'
import { StudioBeat } from './beat.js'
import { EvidenceCard, VerdictCard } from './cards.js'
import { QuestionCard } from '../question-card.js'
import { DecisionBrief, parseDecisionItems } from './decision-brief.js'
import { isDispatchHandoff } from './handoff.js'

// 工作室先接管自己的消息类型，其余交给共享渲染器。
export const renderStudioMessage = ({
  room,
  byId,
  message,
  timeline,
  onAccept,
  onStageAccept,
  onAnswerCard = null,
  advisor = { available: false, host: '' },
  onShadowReconfirm = null,
  onCancelQueue = null,
  onSteerQueue = null,
}) => {
  // 人工签字已有系统行；不再复制一张验收员样式的卡。
  if (message.kind === 'verdict' && message.meta?.human === true) return null
  if (isDispatchHandoff(room, message)) return h(Baton, { key: message.id, message, room, byId })
  const member = resolveMember(room, byId, message)
  if (message.kind === 'question') {
    return h(QuestionCard, { key: message.id, message, member, onAnswer: onAnswerCard })
  }
  if (message.kind === 'dispatch' || message.kind === 'handoff') return h(Baton, { key: message.id, message, room, byId })
  // 检查是这一步的结果，不是群里的第四个人；系统证据不显示作者名。
  if (message.kind === 'evidence') {
    return h(EvidenceCard, { key: message.id, message, member: message.authorId === 'system' ? null : member })
  }
  if (message.kind === 'verdict') {
    return h(VerdictCard, {
      key: message.id,
      message,
      member,
      room,
      stage: room.stages[message.meta?.stage ?? 0],
      onAccept: onStageAccept === null ? undefined : onStageAccept ?? onAccept,
      advisor,
      onShadowReconfirm,
      evidence: timeline.evidenceFor.get(message.id),
    })
  }
  // 成员发言在工作室里是一拍工作记录：第一段可见，完整内容展开。
  // 主成员给出两三条要确认的事时，直接变成决策卡，不把整段聊天铺在首屏。
  if (message.kind === 'chat' && message.authorId !== 'you') {
    const isLead = message.authorId === room.leadMemberId
    const pending = room.needsYou?.kind === 'decision' && isLead
    const items = isLead ? parseDecisionItems(message.text) : []
    if (items.length >= 2) {
      const active = Array.isArray(room.stages)
        ? room.stages.findIndex(stage => stage.state === 'active')
        : -1
      const activeStage = active >= 0 ? room.stages[active] : undefined
      const opening = active === 0 && /确认|对齐/.test(activeStage?.title ?? '')
      const accept = onStageAccept ?? onAccept
      return h(DecisionBrief, {
        key: message.id,
        message,
        member,
        items,
        pending,
        disabled: room.state !== 'active',
        actionLabel: opening ? '按这个开工' : '按这个继续',
        onAccept: pending && typeof accept === 'function' && active >= 0
          ? () => accept(active)
          : undefined,
      })
    }
    return h(StudioBeat, { key: message.id, message, member, open: pending })
  }
  return renderSharedMessage({ room, byId, message, onAnswerCard, onCancelQueue, onSteerQueue })
}
