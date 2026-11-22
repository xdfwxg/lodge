import { buildMemberHandoff } from './member-handoff.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { alignmentPrompt, directPrompt } from '../create/prompts.js'
import { STAGE_STATE } from '../../../../shared/states.js'

// 工作室建房后的第一次派发：先对齐，或直接交给主成员/执行成员。
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
    const context = buildMemberHandoff({ room, messages: store.readMessages(room.id), memberId: targetMember.id })
    const sent = await live.sendToMember(
      room.id,
      targetMember.id,
      `${opening}\n\n${context}\n${INTERNAL_PROMPT_MARKER}`,
      { intent: align ? 'align' : 'handoff', from: 'Lodge' },
    )
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
