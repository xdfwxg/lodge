import { PLANNER_DECISION_KIND, ROOM_STATE, STAGE_STATE } from '../../../../../shared/states.js'
import { stagesCompletedOf } from '../../../../../shared/room-status.js'

export const NO_PROGRESS_LIMIT = 6

// 空转守卫：只数“有没有产出”，不数消息条数。六轮没有产出就暂停并等人。
export const advanceProgress = (room, { progressed, at = Date.now() }) => {
  room.turnCount = Number(room.turnCount ?? 0) + 1
  // 已交付的房间只剩聊天，没有阶段可推进；空转守卫不该把它暂停。
  const delivered = stagesCompletedOf(room)
  if (delivered) {
    room.noProgress = 0
    return { paused: false }
  }
  if (progressed) {
    room.noProgress = 0
    room.lastProgressAt = at
    return { paused: false }
  }
  const activeIndex = Array.isArray(room.stages) ? room.stages.findIndex(stage => stage.state === STAGE_STATE.active) : -1
  if (room.lastPlannerDecision?.kind === PLANNER_DECISION_KIND.human && room.lastPlannerDecision?.stage === activeIndex) {
    room.noProgress = 0
    return { paused: false }
  }
  room.noProgress = Number(room.noProgress ?? 0) + 1
  if (room.noProgress >= NO_PROGRESS_LIMIT && room.state === ROOM_STATE.active) {
    room.state = ROOM_STATE.paused
    room.idle = true
    room.openQuestion = null
    return { paused: true }
  }
  return { paused: false }
}
