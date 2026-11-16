import { roleKindOf } from './roster.js'

// 房间成员只回答“有谁”：身份、职责、权限和工作区。身体能力从当前身体读取。
const kindOf = member => member?.roleKind ?? roleKindOf(member?.role)

export const memberOf = (room, id) => (
  (room?.members ?? []).find(member => member?.id === id) ?? null
)

export const memberName = (room, id) => memberOf(room, id)?.name ?? id

export const leadMemberOf = room => {
  const chosen = memberOf(room, room?.leadMemberId)
  if (chosen !== null) return chosen
  return (room?.members ?? []).find(member => member?.role === 'lead')
    ?? (room?.members ?? [])[0]
    ?? null
}

export const workerMembers = room => (room?.members ?? []).filter(member => kindOf(member) === 'executor')

export const verifierMembers = room => (room?.members ?? []).filter(member => kindOf(member) === 'verifier')

export const workerIds = room => workerMembers(room).map(member => member.id)

export const verifierIds = room => verifierMembers(room).map(member => member.id)

export const memberIdList = room => (room?.members ?? []).map(member => member.id)

export const memberLabelMap = room => Object.fromEntries(
  (room?.members ?? []).map(member => [member.id, member.name]),
)
