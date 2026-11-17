import { Fragment, createElement as h, useMemo } from 'react'
import { buildTimeline, dedupeChatStreams } from '../timeline-model.js'
import { DeliveryCard } from './delivery-card.js'
import { ShadowAdvice } from './advisor-advice.js'
import { renderStudioMessage } from './message-view.js'
import { displayableStep } from './transcript-model.js'
import { StudioStep } from './step-line.js'

const orderOf = message => (
  (typeof message.ts === 'number' ? message.ts : 0) * 1000 + (typeof message.seq === 'number' ? message.seq : 0)
)

// 工作室时间线就是一条聊天记录：规划师排期、交接、执行、验收、退回都在同一条线上，
// 不切章节、不截窗口、不隐藏阶段结论；细节挂在各自的消息里，需要时再展开。
export function StudioTranscript({
  room,
  members,
  onAccept,
  onStageAccept,
  onAnswerCard = null,
  onCancelQueue = null,
  onSteerQueue = null,
  onContinue = null,
  onReturn = null,
  onRework = null,
  hideKinds = [],
  delivery = null,
}) {
  const byId = useMemo(() => Object.fromEntries(members.map(member => [member.id, member])), [members])
  const messages = useMemo(
    () => dedupeChatStreams(room.messages).slice().sort((a, b) => orderOf(a) - orderOf(b)),
    [room.messages],
  )
  const timeline = useMemo(() => buildTimeline(messages), [messages])
  const hidden = useMemo(() => new Set(hideKinds), [hideKinds])
  // 同一个人把同一句话既写进聊天又从证据里回来时，只留聊天那一句。
  const renderable = useMemo(() => {
    const normalize = text => String(text ?? '')
      .replace(/^\s*(PASS|REJECT)\b[\s:：\-/]*/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    const chatKey = message => `${message.authorId}|${normalize(message.text)}`
    const chats = new Set(messages.filter(message => message.kind === 'chat').map(chatKey))
    const verdicts = new Set(messages.filter(message => message.kind === 'verdict').map(chatKey))
    const consumed = new Set(messages
      .filter(message => message.kind === 'verdict' && typeof message.meta?.evidenceId === 'string')
      .map(message => message.meta.evidenceId))
    return messages.filter(message => {
      if (message.kind === 'evidence') {
        if (consumed.has(message.id)) return false
        if (chats.has(chatKey(message))) return false
      }
      if (message.kind === 'chat' && verdicts.has(chatKey(message))) return false
      return true
    })
  }, [messages])

  const items = []
  let lastStage = null
  for (const message of renderable) {
    if (hidden.has(message.kind)) continue
    const stage = message.meta?.stage
    if (Number.isInteger(stage) && stage !== lastStage) {
      lastStage = stage
      const title = room.stages?.[stage]?.title ?? ''
      items.push(h('div', { key: `stage-${stage}-${message.id}`, className: 'crew-stage-divider' },
        h('span', { className: 'crew-stage-divider-text' },
          `第 ${stage + 1} 步${title === '' ? '' : ` · ${title}`}`)))
    }
    if (message.kind === 'activity') {
      if (!displayableStep(message)) continue
      items.push(h(StudioStep, { key: message.id, step: message, live: false }))
      continue
    }
    const content = renderStudioMessage({
      room,
      byId,
      message,
      timeline,
      onAccept,
      onStageAccept,
      onAnswerCard,
      onCancelQueue,
      onSteerQueue,
    })
    if (content !== null && content !== undefined) items.push(content)
  }

  const activeIndex = (room.stages ?? []).findIndex(stage => stage.state === 'active')
  const need = room.needsYou
  const canAccept = room.state === 'active' && activeIndex >= 0
    && (need?.kind === 'signoff' || need?.kind === 'decision')
  const canRework = room.state === 'active' && activeIndex >= 0 && typeof onRework === 'function'
  const actions = canAccept || canRework
    ? h('div', { key: 'actions', className: 'crew-room-actions' },
      canAccept
        ? h('button', {
          type: 'button',
          className: 'crew-accept',
          onClick: () => (onStageAccept ?? onAccept)?.(activeIndex),
        }, need?.kind === 'signoff' ? '签字收尾' : '按这个继续')
        : null,
      canRework
        ? h('button', {
          type: 'button',
          className: 'crew-ghost',
          onClick: () => onRework(activeIndex),
        }, '退回重做')
        : null)
    : null

  const advice = activeIndex >= 0
    ? h(ShadowAdvice, { key: `advice-${activeIndex}`, room, stageIndex: activeIndex, label: '影子评审（仅供参考）' })
    : null

  return h(Fragment, null,
    h('div', { className: 'studio-timeline' }, ...items),
    advice,
    delivery === null || delivery === undefined
      ? null
      : h(DeliveryCard, { key: 'delivery', delivery, onContinue, onReturn }),
    actions)
}
