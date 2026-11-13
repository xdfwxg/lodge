import * as chat from './chat.js'
import * as studio from './studio.js'

// 只有聊天室和工作室两种房型；没有旧房型兼容。
export const roomTypeStrategies = [studio, chat]

export const resolveRoomType = value => {
  // 没带房型的调用按工作室处理；未知房型 fail closed。
  if (value === undefined || value === null || value === '') return studio
  return roomTypeStrategies.find(item => item.id === value) ?? null
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
