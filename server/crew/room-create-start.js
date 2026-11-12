import { buildSeatHandoff } from './seat-handoff.js'
import { markSeatRead } from './watermarks.js'
import { alignmentPrompt, directPrompt } from './room-create-input.js'

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
  effectiveAcceptance,
  autoStart,
  emit,
}) => {
  if (autoStart !== 'stage') return room
  const activeStage = room.stages.findIndex(stage => stage.state === 'active')
  if (plan !== null) {
    if (activeStage >= 0) await live.startStage(room, activeStage)
  } else if (!align && workers.length > 1) {
    if (activeStage >= 0) await live.startStage(room, activeStage)
  } else {
    const targetSeat = align ? lead : worker
    markSeatRead({ store, roomId: room.id, seat: targetSeat.id, emit })
    const opening = align
      ? alignmentPrompt(targetSeat.name, goal, verify, effectiveAcceptance)
      : directPrompt(goal, verify, effectiveAcceptance, roster.length === 1)
    const context = buildSeatHandoff({ room, messages: store.readMessages(room.id), seat: targetSeat.id })
    const sent = await live.sendToSeat(room.id, targetSeat.id, `${opening}\n\n${context}`)
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
