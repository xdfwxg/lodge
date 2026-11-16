import { roleKindOf } from './roster.js'

// 房间成员是房间自己的团队：身份、职责、能力、身体都在这一条记录里。
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

const bodyFrom = (room, spec) => {
  const ref = room?.seatBots?.[spec.id]
  const name = room?.seatNames?.[spec.id] ?? spec.name
  const baseRoom = room?.seatRooms?.[spec.id]
  return {
    kind: 'base',
    ...(typeof ref === 'string' && ref !== '' ? { ref } : {}),
    ...(typeof name === 'string' && name !== '' ? { name } : {}),
    ...(typeof baseRoom?.id === 'string' && baseRoom.id !== '' ? { roomRef: baseRoom.id } : {}),
    ...(typeof baseRoom?.sessionRef === 'string' && baseRoom.sessionRef !== '' ? { sessionRef: baseRoom.sessionRef } : {}),
  }
}

const memberFromSpec = (room, spec) => {
  const { memberId: _memberId, ...rest } = spec
  return {
    ...rest,
    id: spec.id,
    kind: spec.kind ?? 'ai',
    roleKind: spec.roleKind ?? roleKindOf(spec.role),
    body: bodyFrom(room, spec),
  }
}

const memberFromId = (room, id) => {
  const role = id === room?.leadSeat
    ? 'lead'
    : (room?.verifiers ?? []).includes(id) ? 'verifier' : 'worker'
  return {
    id,
    kind: 'ai',
    name: room?.seatNames?.[id] ?? id,
    title: '',
    role,
    roleKind: roleKindOf(role),
    station: '',
    permissions: { read: false, exec: false, write: false },
    writeScope: 'none',
    toolSurface: [],
    skills: [],
    mcp: [],
    approval: 'ask',
    speakBudget: 0,
    body: bodyFrom(room, { id, name: room?.seatNames?.[id] ?? id }),
  }
}

const OLD_FIELDS = [
  'seatSpecs', 'seatBots', 'seatNames', 'seatRooms',
  'leadSeat', 'workers', 'verifiers', 'seatCursors',
]

const dropOldFields = room => {
  let changed = false
  for (const field of OLD_FIELDS) {
    if (!Object.hasOwn(room, field)) continue
    delete room[field]
    changed = true
  }
  return changed
}

// 旧房间把成员拆成四五份平行字段；启动时一次性压成 room.members。
export const migrateRoomMembers = store => {
  let migrated = 0
  for (const room of store.readRooms()) {
    const hasMemberObjects = Array.isArray(room.members) && room.members.length > 0 && typeof room.members[0] === 'object' && room.members[0] !== null
    if (!hasMemberObjects) {
      const specs = Array.isArray(room.seatSpecs) ? room.seatSpecs : []
      const ids = Array.isArray(room.members) ? room.members : []
      const members = specs.length > 0
        ? specs.map(spec => memberFromSpec(room, spec))
        : ids.map(id => memberFromId(room, id))
      room.members = members
      room.leadMemberId = room.leadSeat
        ?? members.find(member => member.role === 'lead')?.id
        ?? members[0]?.id
        ?? null
      room.memberCursors = room.seatCursors ?? {}
      dropOldFields(room)
      store.writeRoom(room)
      migrated += 1
      continue
    }

    let changed = false
    if (room.leadMemberId === undefined) {
      room.leadMemberId = room.leadSeat
        ?? room.members.find(member => member.role === 'lead')?.id
        ?? room.members[0]?.id
        ?? null
      changed = true
    }
    if (room.memberCursors === undefined) {
      room.memberCursors = room.seatCursors ?? {}
      changed = true
    }
    if (dropOldFields(room)) changed = true
    if (changed) {
      store.writeRoom(room)
      migrated += 1
    }
  }
  return migrated
}
