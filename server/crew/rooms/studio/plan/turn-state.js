import { readGateSubmission } from '../../../gate/spool.js'
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
      const meta = message.meta ?? {}
      if ((message.kind === 'evidence' || message.kind === 'verdict' || meta.kind === 'turn_stopped') &&
        typeof meta.turnId === 'string') {
        capturedTurns.add(meta.turnId)
      }
    }
  }

  const trackTool = message => {
    if (message.kind !== 'activity' || typeof message.turnId !== 'string') return
    const calls = turns.get(message.turnId) ?? []
    // 回执里带 ok：被工具拒掉的调用不能当成一次提交，判定侧要按原话让模型重交。
    const tool = { ...fullToolOf(message.tool ?? {}), ok: message.ok !== false }
    // 同一个工具调用会先来“开始”，完成后再补一次回执；后到的版本覆盖前一条，不能当成重复丢掉。
    const itemId = message.tool?.id ?? message.tool?.itemId
    const index = itemId === undefined ? -1 : calls.findIndex(call => (call.id ?? call.itemId) === itemId)
    if (index >= 0) calls[index] = tool
    else calls.push(tool)
    turns.set(message.turnId, calls)
  }

  const recordTurn = progressed => {
    let paused = false
    // 暂停时要清 openQuestion（轮次字段）；用 updateRoom 写会抛错，让房间连不上。
    const updated = store.updateRound(roomId, current => {
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
