export const NO_PROGRESS_LIMIT = 6

// 空转守卫：只数“有没有产出”，不数消息条数。六轮没有产出就暂停并等人。
export const advanceProgress = (room, { progressed, at = Date.now() }) => {
  room.round = Number(room.round ?? 0) + 1
  if (progressed) {
    room.noProgress = 0
    room.lastProgressAt = at
    return { paused: false }
  }
  room.noProgress = Number(room.noProgress ?? 0) + 1
  if (room.noProgress >= NO_PROGRESS_LIMIT && room.state === 'active') {
    room.state = 'paused'
    room.idle = true
    room.openQuestion = null
    return { paused: true }
  }
  return { paused: false }
}
