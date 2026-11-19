// 房间动作的唯一清单：HTTP 路由和路由扫描共用。新增动作只改这里，
// 漏加会让 route-sweep 直接失败，而不是等到用户点到一个“没有这个接口”。
export const ROOM_ACTIONS = Object.freeze([
  'messages',
  'lodge',
  'accept',
  'human-choice',
  'chat-continue',
  'chat-resume',
  'resume',
  'stop',
  'reject-plan',
  'rework',
  'resolve-merge',
  'routine',
  'retry',
  'rewind',
  'switch-mode',
  'read',
  'hold',
  'steer',
  'cancel-queue',
  'answer-card',
  'acceptance',
  'verify',
  'approvals',
  'subrooms',
  'add-member',
  'remove-member',
  'swap-body',
  'rename',
  'archive',
  'delete',
])

export const roomActionPattern = new RegExp(`^/api/rooms/([^/]+)/(${ROOM_ACTIONS.join('|')})$`)

export const matchRoomAction = path => {
  const match = roomActionPattern.exec(path)
  return match === null ? null : { roomId: match[1], action: match[2] }
}
