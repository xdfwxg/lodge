import * as archive from './archive.js'
import * as chat from './chat.js'
import * as roundtable from './roundtable.js'
import * as studio from './studio.js'
import * as task from './task.js'

// 公开两种模式：聊天室和工作室。旧房型只做读兼容，不再出现在建房选择器里。
export const roomTypeStrategies = [studio, chat]

const legacy = new Map([
  [task.id, task],
  [roundtable.id, roundtable],
  [archive.id, archive],
])

export const resolveRoomType = value => {
  // 新 UI 一定显式发送 studio/chat；没有房型的旧调用保持 task 兼容。
  if (value === undefined || value === null || value === '') return task
  return roomTypeStrategies.find(item => item.id === value) ?? legacy.get(value) ?? null
}

export const listRoomTypes = () => roomTypeStrategies.map(item => ({
  id: item.id,
  name: item.name,
  description: item.description,
  defaultVerify: item.defaultVerify,
  defaultSeats: item.defaultSeats,
  readOnly: item.readOnly === true,
  autoStart: item.autoStart,
  singleDirectory: item.singleDirectory === true,
}))
