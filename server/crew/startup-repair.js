import { findRedundantOpeningGate, normalizeManualStages } from './room-repair.js'

export const repairManualStages = store => {
  for (const room of store.readRooms()) {
    if (normalizeManualStages(room) === null) continue
    const updated = store.updateRoom(room.id, current => {
      const stages = normalizeManualStages(current)
      if (stages === null) return null
      current.stages = stages
      return { events: [{ type: 'stage.manual_normalized', payload: {} }] }
    })
    if (updated === null) continue
    store.appendMessage(room.id, {
      kind: 'system',
      text: '验收方式为人工确认，已改为由你确认，不再执行命令。',
    })
  }
}

export const repairOpeningGates = async ({ store, service, roomFiles }) => {
  for (const room of store.readRooms()) {
    const index = findRedundantOpeningGate(room, roomFiles)
    if (index < 0) continue
    await service.roomRequest(room.id, 'accept', {
      method: 'POST',
      readBody: async () => ({ stage: index }),
    })
  }
}
