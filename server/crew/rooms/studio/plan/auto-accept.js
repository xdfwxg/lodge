import { ROOM_STATE } from '../../../../../shared/states.js'

// 只有工作阶段的收尾能自动确认；开工的对齐阶段仍由建房/规划流程决定。
export const autoAcceptStageOf = room => {
  if (room?.roomType !== 'studio' || room.state !== ROOM_STATE.active || room.demo === true) return null
  const need = room.needsYou
  if (need === null || need === undefined || need.kind !== 'signoff') return null
  return Number.isInteger(need.stage) ? need.stage : null
}

// 业务规则只回答“该不该确认”；真正的确认动作由调用方注入。
export const createStudioAutoAcceptor = ({
  accept,
  onError = null,
  delayMs = 400,
  schedule = (run, ms) => setTimeout(run, ms),
  cancel = id => clearTimeout(id),
}) => {
  const pending = new Set()
  const timers = new Set()

  const acceptRoom = room => {
    const stage = autoAcceptStageOf(room)
    if (stage === null) return false
    const key = `${room.id}:${stage}`
    if (pending.has(key)) return false
    pending.add(key)
    const entry = { timer: null }
    entry.timer = schedule(() => {
      timers.delete(entry)
      pending.delete(key)
      Promise.resolve()
        .then(() => accept(room, stage))
        .catch(error => onError?.(room, stage, error))
    }, delayMs)
    timers.add(entry)
    return true
  }

  const stop = () => {
    for (const entry of timers) cancel(entry.timer)
    timers.clear()
    pending.clear()
  }

  return { accept: acceptRoom, stop }
}
