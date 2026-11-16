// 成员显示名只从房间的 members 取；身体名不能直接上屏。
export const memberNameOf = (room, memberId) => (
  (room?.members ?? []).find(member => member.id === memberId)?.name ??
  (typeof memberId === 'string' && memberId !== '' ? memberId : '')
)
