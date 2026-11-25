import { createBodyFactory } from '../../body.js'

// 删房时把成员身体、隐藏 Bot 和房间聊天群一起退役；工作区和用户文件不在这层处理。
export const retireRoomResources = async ({ engine, room }) => {
  const bodies = createBodyFactory({ engine })
  for (const member of room.members ?? []) {
    if (member?.body !== undefined) await bodies.retire(member.body)
  }
  for (const ref of [room.chatHost?.memberRef]) {
    await bodies.retireHost(ref)
  }
  if (typeof room.chatRoom?.id === 'string' && room.chatRoom.id !== '') {
    await engine.deleteRoom(room.chatRoom.id)
  }
}
