// 聊天探针只借已存在的房间；Lodge 主房没有成员，不能拿它当默认目标。
const roomHasMemberBots = room => (room?.members ?? []).some(member => (
  typeof member?.body?.ref === 'string' && member.body.ref !== ''
))

export const pickChatRoom = (rooms, roomArg) => {
  if (roomArg !== undefined) {
    const room = rooms.find(item => item.id === roomArg)
    if (room === undefined) return { error: `找不到房间 ${roomArg}` }
    if (!roomHasMemberBots(room)) return { error: `房间 ${roomArg} 没有成员 bot；聊天探针需要一间有成员的聊天室` }
    return { room }
  }
  const room = rooms.find(item => (
    item.roomType === 'chat' &&
    item.lodge !== true &&
    item.live === true &&
    roomHasMemberBots(item)
  )) ?? rooms.find(item => (
    item.roomType === 'chat' &&
    item.lodge !== true &&
    roomHasMemberBots(item)
  ))
  if (room === undefined) return { error: '没有用于评测的聊天室；先建一间有成员的即时聊天室' }
  return { room }
}
