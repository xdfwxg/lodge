import { createBodyFactory } from '../../body.js'

// 删房时把成员身体、隐藏 Bot 和房间聊天群一起退役；工作区和用户文件不在这层处理。
// 有一样没退役成功就整批报错：房间保留，让人等基座恢复后重试，不假装删干净。
export const retireRoomResources = async ({ engine, room }) => {
  const bodies = createBodyFactory({ engine })
  const failures = []
  for (const member of room.members ?? []) {
    if (member?.body === undefined) continue
    try {
      await bodies.retire(member.body, { strict: true })
    } catch (error) {
      failures.push(`${member.name ?? member.id}：${error?.message ?? error}`)
    }
  }
  try {
    await bodies.retireHost(room.chatHost?.memberRef, { strict: true })
  } catch (error) {
    failures.push(`主持：${error?.message ?? error}`)
  }
  if (typeof room.chatRoom?.id === 'string' && room.chatRoom.id !== '') {
    try {
      await engine.deleteRoom(room.chatRoom.id, { strict: true })
    } catch (error) {
      failures.push(`聊天群：${error?.message ?? error}`)
    }
  }
  if (failures.length > 0) throw new Error(failures.join('；'))
}
