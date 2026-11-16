import { buildSeatHandoff } from './seat-handoff.js'
import { markSeatRead } from '../../watermarks.js'
import { INTERNAL_PROMPT_MARKER } from '../../internal-prompts.js'
import { alignmentPrompt, directPrompt } from '../create/input.js'

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
  const activeStage = room.stages.findIndex(stage => stage.state === 'active')
  if (plan !== null) {
    if (activeStage >= 0) await live.startStage(room, activeStage)
  } else if (!align && workers.length > 1) {
    if (activeStage >= 0) await live.startStage(room, activeStage)
  } else {
    const targetSeat = align ? lead : worker
    markSeatRead({ store, roomId: room.id, seat: targetSeat.id, emit })
    const openingName = targetSeat.name
    const opening = align
      ? alignmentPrompt(openingName, goal, verify, acceptance, room.handoff)
      : `@${openingName}\n${directPrompt(goal, verify, acceptance, roster.length === 1, room.handoff)}`
    const context = buildSeatHandoff({ room, messages: store.readMessages(room.id), seat: targetSeat.id })
    const sent = await live.sendToSeat(
      room.id,
      targetSeat.id,
      `${opening}\n\n${context}\n${INTERNAL_PROMPT_MARKER}`,
      { intent: align ? 'align' : 'handoff', from: 'Lodge' },
    )
    if (sent.messageId !== null) {
      const updated = store.updateRoom(room.id, current => {
        current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
        return { events: [] }
      })
      if (updated !== null) room = updated
    }
  }
  return room
}
