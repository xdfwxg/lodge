import { readGateSubmission } from '../../gate/spool.js'
import { advanceProgress, NO_PROGRESS_LIMIT } from './progress.js'

// 基座活动里的 input 是给界面看的预览，长方案会被截成「[additional data omitted]」。
// 判定工具的成功回执带 submissionId；有它就用暂存的完整入参替换预览，平台照旧重新校验。
const fullToolOf = tool => {
  const output = typeof tool.output === 'string'
    ? (() => { try { return JSON.parse(tool.output) } catch { return null } })()
    : tool.output
  const submissionId = output?.submissionId
  if (typeof submissionId !== 'string') return tool
  const args = readGateSubmission(submissionId)
  return args === null ? tool : { ...tool, input: JSON.stringify(args) }
}

export const createTurnState = ({ store, roomId, emit }) => {
  const turns = new Map()
  const capturedTurns = new Set()
  const resultRuns = new Set()

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
    const tool = fullToolOf(message.tool ?? {})
    // 同一个工具调用会先来“开始”，完成后再补一次回执；后到的版本覆盖前一条，不能当成重复丢掉。
    const index = message.tool?.id === undefined ? -1 : calls.findIndex(call => call.id === message.tool.id)
    if (index >= 0) calls[index] = tool
    else calls.push(tool)
    turns.set(message.turnId, calls)
  }

  const recordTurn = progressed => {
    let paused = false
    const updated = store.updateRoom(roomId, current => {
      const result = advanceProgress(current, { progressed })
      paused = result.paused
      return {
        events: [
          { type: 'room.turn', payload: { turnCount: current.turnCount, noProgress: current.noProgress, progressed } },
          ...(paused ? [{ type: 'room.idle', payload: { reason: 'no-progress' } }] : []),
        ],
      }
    })
    if (updated === null) return
    if (paused) {
      store.appendMessage(roomId, { kind: 'system', text: `连续 ${NO_PROGRESS_LIMIT} 轮没有产出，房间已暂停，可以接着聊。` })
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

  return {
    turns,
    capturedTurns,
    resultRuns,
    seed,
    trackTool,
    recordTurn,
    markProgress,
  }
}
