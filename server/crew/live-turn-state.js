import { advanceProgress, NO_PROGRESS_LIMIT } from './progress.js'

export const createTurnState = ({ store, roomId, emit }) => {
  const turns = new Map()
  const capturedTurns = new Set()
  const acceptanceRuns = new Set()

  const seed = messages => {
    for (const message of messages) {
      if ((message.kind === 'evidence' || message.kind === 'verdict') && typeof message.meta?.turnId === 'string') {
        capturedTurns.add(message.meta.turnId)
      }
    }
  }

  const trackTool = message => {
    if (message.kind !== 'activity' || typeof message.turnId !== 'string') return
    const calls = turns.get(message.turnId) ?? []
    if (message.tool?.id !== undefined && calls.some(call => call.id === message.tool.id)) return
    calls.push(message.tool ?? {})
    turns.set(message.turnId, calls)
  }

  const recordTurn = progressed => {
    let paused = false
    const updated = store.updateRoom(roomId, current => {
      const result = advanceProgress(current, { progressed })
      paused = result.paused
      return {
        events: [
          { type: 'room.turn', payload: { round: current.round, noProgress: current.noProgress, progressed } },
          ...(paused ? [{ type: 'room.idle', payload: { reason: 'no-progress' } }] : []),
        ],
      }
    })
    if (updated === null) return
    if (paused) {
      store.appendMessage(roomId, { kind: 'system', text: `连续 ${NO_PROGRESS_LIMIT} 轮没有产出，房间已暂停；等你说话。` })
    }
    emit?.('room', updated)
  }

  const markProgress = () => {
    const updated = store.updateRoom(roomId, current => {
      current.noProgress = 0
      current.lastProgressAt = Date.now()
      return { events: [{ type: 'room.progress', payload: { at: current.lastProgressAt } }] }
    })
    if (updated !== null) emit?.('room', updated)
  }

  const updateTasks = (stageIndex, mutate) => {
    const updated = store.updateRoom(roomId, current => {
      const stage = current.stages[stageIndex]
      if (stage === undefined) return null
      const next = mutate(stage)
      if (next === stage) return null
      current.stages[stageIndex] = next
      return { events: [] }
    })
    if (updated !== null) emit?.('room', updated)
  }

  return {
    turns,
    capturedTurns,
    acceptanceRuns,
    seed,
    trackTool,
    recordTurn,
    markProgress,
    updateTasks,
  }
}
