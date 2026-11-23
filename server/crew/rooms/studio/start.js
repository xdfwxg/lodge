import { buildMemberHandoff } from './member-handoff.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { alignmentPrompt, directPrompt } from '../create/prompts.js'
import { memberDisplayName } from '../../member-labels.js'
import { sanitizeUntrusted } from '../../../../shared/untrusted-text.js'
import { missingMentionsOf } from './relay-words.js'
import { historyBriefOf } from './history-brief.js'
import { STAGE_STATE } from '../../../../shared/states.js'

// 工作室建房后的第一次派发：先对齐，或直接交给主成员/执行官。
export const startInitialStage = async ({
  store,
  live,
  room,
  plan,
  align,
  workers,
  lead,
  worker,
  roster,
  goal,
  verify,
  acceptance,
  emit,
}) => {
  // 建房记录里的阶段状态可能还是旧的；以落库后的房间为准再决定从哪一步开始。
  room = store.readRoom(room.id) ?? room
  const activeStage = room.stages.findIndex(stage => stage.state === STAGE_STATE.active)
  if (plan !== null) {
    if (activeStage >= 0) await live.startStage(room, activeStage)
  } else if (!align && workers.length > 1) {
    if (activeStage >= 0) await live.startStage(room, activeStage)
  } else {
    const targetMember = align ? lead : worker
    const opening = align
      ? alignmentPrompt(goal, verify, acceptance, room.handoff)
      : directPrompt(goal, verify, acceptance, roster.length === 1, room.handoff)
    // 规划师开口前先看一眼这间房里的旧决策和旧结论；只读、同房间、按本轮话检索。
    const history = align
      ? historyBriefOf({
        store,
        room,
        query: goal,
        before: room.workRound?.startedAt ?? Date.now(),
      })
      : { text: '', messageIds: [] }
    const context = buildMemberHandoff({ room, messages: store.readMessages(room.id), memberId: targetMember.id })
    const sent = await live.sendToMember(
      room.id,
      targetMember.id,
      `${opening}${history.text === '' ? '' : `\n\n${history.text}`}\n\n${context}\n${INTERNAL_PROMPT_MARKER}`,
      { intent: align ? 'align' : 'handoff', from: 'Lodge' },
    )
    // 直接派发也要有群里的一条 @：模型被要求不 @，系统的投影不能省。
    // 这条 @ 是领队说的话，按成员消息渲染，不做居中小字。
    const stageIndex = activeStage >= 0 ? activeStage : 0
    if (history.messageIds.length > 0) {
      store.appendEvent(room.id, 'history.brief', { stage: stageIndex, messageIds: history.messageIds })
    }
    const stageTitle = sanitizeUntrusted(room.stages?.[stageIndex]?.title ?? room.goal, 120)
    const senderId = align ? 'lodge' : (lead?.id ?? 'lodge')
    // 对齐回合由规划师自己 @ 下一位（系统把计划交给执行官），不再补第二条；
    // 直接派发没有规划师发言，才由系统投影这句交接。
    const missing = missingMentionsOf({
      room,
      messages: store.readMessages(room.id),
      from: senderId,
      targets: [targetMember.id],
    })
    if (!align && missing.length > 0) {
      store.appendMessage(room.id, {
        kind: 'system',
        authorId: senderId,
        text: `@${memberDisplayName(room, targetMember.id)} 第 ${stageIndex + 1} 步「${stageTitle}」交给你。`,
        meta: { kind: 'handoff', stage: stageIndex, from: senderId, to: [targetMember.id], authorKind: 'system' },
      })
    }
    if (sent.messageId !== null) {
      const updated = store.updateRound(room.id, current => {
        current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
        return { events: [] }
      })
      if (updated !== null) room = updated
    }
  }
  return room
}
