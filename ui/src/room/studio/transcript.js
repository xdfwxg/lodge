import { Fragment, createElement as h, useMemo, useState } from 'react'
import { buildTimeline, dedupeChatStreams } from '../timeline-model.js'
import { humanNoteKeys, isDuplicateHumanRework } from '../human-note.js'
import { ShadowAdvice } from './advisor-advice.js'
import { downloadDeliveryRecord } from './delivery-record.js'
import { renderStudioMessage } from './message-view.js'
import { HumanGateCard } from './human-gate.js'
import { MergeConflictCard } from './merge-conflict.js'
import { DeliveryCard } from './delivery-card.js'

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
  onDiscussChat = null,
  onReturn = null,
  onRework = null,
  onResolveMerge = null,
  hideKinds = [],
  delivery = null,
}) {
  const [processOpen, setProcessOpen] = useState(false)
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
    // 人的重做标记和 human-context 是同一条输入；主时间线只留带“补充上下文”的那一条。
    const humanNotes = humanNoteKeys(messages)
    return messages.filter(message => {
      // 工作式聊天只留人和成员说的话；系统小字不占时间线。
      if (message.kind === 'system' || message.authorId === 'system') return false
      if (isDuplicateHumanRework(message, humanNotes)) return false
      // 过程日志不进主时间线；当前在做什么由岛和正在输入那一行说。
      if (message.kind === 'activity') return false
      if (message.kind === 'evidence') {
        if (consumed.has(message.id)) return false
        if (chats.has(chatKey(message))) return false
      }
      if (message.kind === 'chat' && verdicts.has(chatKey(message))) return false
      // 验收员的话只留结论卡，不再重复一条长聊天。
      if (message.kind === 'chat' && byId[message.authorId]?.roleKind === 'verifier') return false
      return true
    })
  }, [messages])

  const items = []
  for (let index = 0; index < renderable.length; index += 1) {
    const message = renderable[index]
    if (hidden.has(message.kind)) continue
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
  const adviceIndex = activeIndex >= 0
    ? activeIndex
    : Object.keys(room.advisorShadow ?? {}).map(Number).sort((a, b) => b - a)[0] ?? -1
  const advice = adviceIndex >= 0
    ? h(ShadowAdvice, { key: `advice-${adviceIndex}`, room, stageIndex: adviceIndex, label: '另一个视角' })
    : null

  const finished = (room.stages ?? []).length > 0 &&
    room.stages.every(stage => stage.state === 'passed')
  const closingActions = h('div', { key: 'room-actions', className: 'studio-room-closing studio-room-actions' },
    h('button', {
      type: 'button',
      className: 'crew-link',
      onClick: () => { downloadDeliveryRecord(room) },
    }, '下载交付记录'),
    typeof onDiscussChat === 'function'
      ? h('button', { type: 'button', className: 'crew-link', onClick: onDiscussChat }, '聊一聊这次成果')
      : null,
    typeof onContinue === 'function'
      ? h('button', { type: 'button', className: 'crew-link', onClick: onContinue }, '开一间新房')
      : null)
  // 做完了就只给结果；过程留在“看过程”里，需要时再出现。
  if (finished) {
    return h('div', { className: 'studio-result' },
      h('div', { key: 'room-closing', className: 'studio-room-closing-wrap' },
        delivery === null
          ? h('div', { className: 'studio-room-closing' }, h('span', null, '目标完成'))
          : h(DeliveryCard, { delivery }),
        closingActions),
      items.length === 0 && advice === null
        ? null
        : h(Fragment, null,
          h('div', { key: 'process-lead', className: 'studio-process-lead' },
            h('button', {
              type: 'button',
              className: 'crew-link',
              'aria-expanded': processOpen || undefined,
              onClick: () => setProcessOpen(open => !open),
            }, processOpen ? '收起过程' : '看过程')),
          processOpen
            ? h(Fragment, null,
              h('div', { className: 'studio-timeline studio-process-timeline' }, ...items),
              advice)
            : null))
  }
  return h(Fragment, null,
    h('div', { className: 'studio-timeline' }, ...items),
    h(HumanGateCard, { key: `human-gate-${activeIndex}`, room, onRework }),
    h(MergeConflictCard, { key: `merge-${activeIndex}`, room, onResolve: onResolveMerge }),
    advice)
}
