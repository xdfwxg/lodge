import { readTranscript } from './room-repo.js'

// SQLite 是真相。启动时只补“日志写成功、库没写进去”的崩溃窗口；
// 已有的消息绝不从日志覆盖，避免旧流式片段盖掉最终版本。
export const recoverMessages = (store, { rooms = store.readRooms() } = {}) => {
  let recovered = 0
  const roomsWithoutTranscript = []
  for (const room of rooms) {
    if (room.demo === true) continue
    let lines = []
    try {
      lines = readTranscript(room)
    } catch {
      roomsWithoutTranscript.push(room.id)
      continue
    }
    if (lines.length === 0) continue
    const byId = new Map()
    for (const message of lines) byId.set(message.id, message)
    for (const message of byId.values()) {
      if (store.recoverMessage({ ...message, roomId: room.id }) !== null) recovered += 1
    }
  }
  return { recovered, roomsWithoutTranscript }
}
