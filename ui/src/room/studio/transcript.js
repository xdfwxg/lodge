import { Fragment, createElement as h, useMemo } from 'react'
import { buildTimeline, dedupeChatStreams } from '../timeline-model.js'
import { DeliveryCard } from './delivery-card.js'
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

  const items = []
  let lastStage = null
  for (const message of messages) {
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

  return h(Fragment, null,
    h('div', { className: 'studio-timeline' }, ...items),
    delivery === null || delivery === undefined
      ? null
      : h(DeliveryCard, { key: 'delivery', delivery, onContinue, onReturn }))
}
