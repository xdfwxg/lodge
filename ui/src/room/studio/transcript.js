import { Fragment, createElement as h, useMemo } from 'react'
import { buildTimeline, dedupeChatStreams } from '../timeline-model.js'
import { humanNoteKeys, isDuplicateHumanRework } from '../human-note.js'
import { ShadowAdvice } from './advisor-advice.js'
import { downloadDeliveryRecord } from './delivery-record.js'
import { renderStudioMessage } from './message-view.js'
import { isChainMessage } from '../message-view.js'
import { HumanGateCard } from './human-gate.js'
import { StageConfirmCard } from './stage-confirm.js'
import { PendingDecisionCard } from './pending-decision.js'
import { MergeConflictCard } from './merge-conflict.js'
import { DeliveryCard } from './delivery-card.js'
import { ApprovalCard } from '../../approval-card.js'
import { ProcessGroup } from './process-group.js'
import { RoomReview } from '../room-review.js'
import { scopeIsValid } from '../../../../shared/attempt.js'
import { stagesCompletedOf } from '../../../../shared/room-status.js'

const orderOf = message => (
  (typeof message.ts === 'number' ? message.ts : 0) * 1000 + (typeof message.seq === 'number' ? message.seq : 0)
)

const isVisibleNotice = message => (
  message?.kind === 'system' && message.meta?.kind === 'notice' && message.meta.show === true
)

// 只有阶段回执留在后台账本；交接是谁交给谁，属于主时间线，不能藏。
const isProcessMessage = message => (
  message?.kind === 'dispatch' ||
  message?.kind === 'stage_conclusion' ||
  (message?.kind === 'system' && message.meta?.kind === 'stage')
)

// 同一条状态提示重复出现时，只留最后一次；前面的已经被后一次取代。
export const dedupeSystemNotices = messages => {
  const latest = new Map()
  for (const message of messages) {
    if (isVisibleNotice(message)) latest.set(message.text, message.id)
  }
  return messages.filter(message => !isVisibleNotice(message) || latest.get(message.text) === message.id)
}

// 工作室时间线就是一条聊天记录：规划师排期、交接、执行、验收、退回都在同一条线上，
// 不切章节、不截窗口、不隐藏阶段结论；细节挂在各自的消息里，需要时再展开。
export function StudioTranscript({
  room,
  members,
  onStageAccept,
  onDecision = null,
  onAnswerCard = null,
  onCancelQueue = null,
  onSteerQueue = null,
  onKeepPromise = null,
  onDiscussChat = null,
  onReturn = null,
  onRework = null,
  onChoose = null,
  onReadArtifact = null,
  onOpenRoom = null,
  onResolveMerge = null,
  onApproval = null,
  onForgetMemory = null,
  hideKinds = [],
  delivery = null,
}) {
  const byId = useMemo(() => Object.fromEntries(members.map(member => [member.id, member])), [members])
  const messages = useMemo(
    () => dedupeSystemNotices(
      dedupeChatStreams(room.messages).slice().sort((a, b) => orderOf(a) - orderOf(b)),
    ),
    [room.messages],
  )
  const timeline = useMemo(() => buildTimeline(messages), [messages])
  const hidden = useMemo(() => new Set(hideKinds), [hideKinds])
  const finished = stagesCompletedOf(room)
  // 同一个人把同一句话既写进聊天又从证据里回来时，只留聊天那一句。
  const renderable = useMemo(() => {
    const normalize = text => String(text ?? '')
      .replace(/^\s*(?:(?:PASS|REJECT)\b|不通过|通过)(?=[\s:：\-/]|$)[\s:：\-/]*/i, '')
      .replace(/[`*_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
    const chatKey = message => `${message.authorId}|${normalize(message.text)}`
    const chats = new Set(messages.filter(message => message.kind === 'chat').map(chatKey))
    const chatTexts = messages.filter(message => message.kind === 'chat').map(message => normalize(message.text))
    const verdicts = new Set(messages.filter(message => message.kind === 'verdict').map(chatKey))
    const consumed = new Set(messages
      .filter(message => message.kind === 'verdict' && typeof message.meta?.evidenceId === 'string')
      .map(message => message.meta.evidenceId))
    // 一回合里成员可能先说过程、再说结果；每个证据只留它前面最后一句，过程话不刷屏。
    const keepChats = new Set()
    const evidenceAuthors = new Set(messages.filter(message => message.kind === 'evidence' && message.authorId).map(message => message.authorId))
    for (const message of messages) {
      if (message.kind !== 'evidence' || !message.authorId) continue
      const chat = [...messages].reverse().find(item => (
        item.kind === 'chat' &&
        item.authorId === message.authorId &&
        (item.ts ?? 0) <= (message.ts ?? 0)
      ))
      if (chat !== undefined) keepChats.add(chat.id)
    }
    // 人的重做标记和 human-context 是同一条输入；主时间线只留带“补充上下文”的那一条。
    const humanNotes = humanNoteKeys(messages)
    // 结论之后再回来的总结属于上一轮，不再横在已交付和结果卡之间。
    const conclusionIndex = finished
      ? messages.reduce((last, message, index) => (message.kind === 'conclusion' ? index : last), -1)
      : -1
    return messages.filter((message, index) => {
      if (conclusionIndex >= 0 && index > conclusionIndex) return false
      // 结论就是下面那张结果卡；不再用一条同目标的气泡说第二遍。
      if (finished && message.kind === 'conclusion') return false
      // 工作式聊天只留人和成员说的话；交接链上的系统消息例外。
      if (message.kind === 'system' || message.authorId === 'system' || message.meta?.authorKind === 'system') return isChainMessage(message)
      if (isDuplicateHumanRework(message, humanNotes)) return false
      if (message.kind === 'chat' && evidenceAuthors.has(message.authorId) && !keepChats.has(message.id)) return false
      if (message.kind === 'evidence') {
        if (consumed.has(message.id)) return false
        const plain = normalize(message.text)
        if (chats.has(chatKey(message))) return false
        // 证据文本可能被截断；只要它是某条成员结果的前缀，就不再重复。
        if (plain.length >= 40 && chatTexts.some(text => text.startsWith(plain))) return false
      }
      if (message.kind === 'chat' && verdicts.has(chatKey(message))) return false
      // 验收员的话只留结论卡，不再重复一条长聊天。
      if (message.kind === 'chat' && byId[message.authorId]?.roleKind === 'verifier') return false
      return true
    })
  }, [messages, byId, finished])

  const send = message => renderStudioMessage({
    room,
    byId,
    message,
    timeline,
    onStageAccept,
    onAnswerCard,
    onCancelQueue,
    onSteerQueue,
    onOpenRoom,
  })
  // 系统交接和阶段回执留在后台账本，不进房间；房间里只有三个角色和结果卡。
  const items = []
  const lastActivityId = [...messages].reverse().find(message => message.kind === 'activity')?.id ?? null
  let pending = []
  const flush = () => {
    if (pending.length === 0) return
    items.push(h(ProcessGroup, {
      key: `process-${pending[0].id}`,
      room,
      activities: pending,
      member: byId[pending[0].authorId] ?? null,
      isLatest: pending[pending.length - 1].id === lastActivityId,
      onForgetMemory,
    }))
    pending = []
  }
  for (const message of renderable) {
    if (isProcessMessage(message)) continue
    if (hidden.has(message.kind)) continue
    if (message.kind === 'activity') {
      if (pending.length > 0 && pending[pending.length - 1].authorId !== message.authorId) flush()
      pending.push(message)
      continue
    }
    flush()
    const content = send(message)
    if (content !== null && content !== undefined) items.push(content)
  }
  flush()

  const activeIndex = (room.stages ?? []).findIndex(stage => stage.state === 'active')
  // 影子评审是执行中的旁注；已经交付时结果卡才是主视线，不再把建议横在结果前。
  const advice = activeIndex >= 0
    ? h(ShadowAdvice, { key: `advice-${activeIndex}`, room, stageIndex: activeIndex, label: '另一份意见' })
    : null

  const roomMessages = Array.isArray(room.messages) ? room.messages : []
  const pendingApprovals = (room.approvals ?? []).filter(approval => (
    approval.state === 'pending' && scopeIsValid(approval.scope, { room, messages: roomMessages })
  ))
  const approvalCards = pendingApprovals.slice(0, 1).map(approval => h(ApprovalCard, {
    key: approval.id,
    approval,
    onDecide: decision => onApproval?.(approval.id, decision),
  }))
  const closingActions = delivery === null
    ? h('div', { key: 'room-actions', className: 'studio-room-closing studio-room-actions' },
      h('button', {
        type: 'button',
        className: 'crew-link',
        onClick: () => { downloadDeliveryRecord(room) },
      }, '下载交付记录'))
    : null
  // 结果就是这一轮时间线的最后一条；检查完可以直接在下面开下一轮。
  if (finished) {
    return h('div', { className: 'studio-timeline studio-result-timeline' },
      ...items,
      h(RoomReview, { key: 'room-review', room, finished: true }),
      h('div', { key: 'room-closing', className: 'studio-result' },
        h('div', { className: 'studio-room-closing-wrap' },
          delivery === null
            ? h('div', { className: 'studio-room-closing' }, h('span', null, '已交付'))
            : h(DeliveryCard, {
              delivery,
              onDiscussChat,
              onKeepPromise,
              onDownload: () => { downloadDeliveryRecord(room) },
              onRead: onReadArtifact,
            }),
          closingActions)))
  }
  return h(Fragment, null,
    h('div', { className: 'studio-timeline' }, ...items),
    ...approvalCards,
    pendingApprovals.length > 1
      ? h('div', { key: 'approval-queue', className: 'crew-system' },
        `还有 ${pendingApprovals.length - 1} 个操作待确认，先处理眼前这个。`)
      : null,
    h(PendingDecisionCard, { key: 'pending-decision', room, onAnswer: onDecision }),
    h(HumanGateCard, { key: `human-gate-${activeIndex}`, room, onChoose, onRework }),
    h(StageConfirmCard, { key: `stage-confirm-${activeIndex}`, room, onAccept: onStageAccept }),
    h(MergeConflictCard, { key: `merge-${activeIndex}`, room, onResolve: onResolveMerge }),
    advice)
}
