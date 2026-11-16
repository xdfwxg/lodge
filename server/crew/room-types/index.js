import * as chat from './chat.js'
import * as studio from './studio.js'

// 只有聊天室和工作室两种房型；没有旧房型兼容。
const roomTypeStrategies = [studio, chat]

export const resolveRoomType = value => {
  // 没带房型的调用按工作室处理；未知房型 fail closed。
  if (value === undefined || value === null || value === '') return studio
  return roomTypeStrategies.find(item => item.id === value) ?? null
}

// 能力矩阵跟着房型描述符走；未知房型返回 null，由调用方 fail closed。
export const capabilitiesFor = typeId => resolveRoomType(typeId)?.capabilities ?? null

export const listRoomTypes = () => roomTypeStrategies.map(item => ({
  id: item.id,
  name: item.name,
  description: item.description,
  defaultVerify: item.defaultVerify,
  defaultMembers: item.defaultMembers,
  readOnly: item.readOnly === true,
  autoStart: item.autoStart,
  singleDirectory: item.singleDirectory === true,
}))
