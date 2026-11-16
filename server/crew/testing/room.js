import { roleKindOf } from '../roster.js'

// 仅测试：把旧夹具字段一次性转成 room.members；产品代码不读这些字段。
export const normalizeLegacyTestRoom = room => {
  const specs = Array.isArray(room?.seatSpecs) ? room.seatSpecs : []
  if (specs.length === 0 && Array.isArray(room?.members) && room.members.length > 0 && typeof room.members[0] === 'object') return room
  const ids = Array.isArray(room?.members) ? room.members : []
  const members = specs.length > 0
    ? specs.map(spec => ({
      ...spec,
      kind: spec.kind ?? 'ai',
      roleKind: spec.roleKind ?? roleKindOf(spec.role),
      body: {
        kind: 'base',
        ...(room.seatBots?.[spec.id] === undefined ? {} : { ref: room.seatBots[spec.id] }),
        name: room.seatNames?.[spec.id] ?? spec.name,
      },
    }))
    : ids.map(id => ({
      id,
      kind: 'ai',
      name: room.seatNames?.[id] ?? id,
      role: id === room.leadSeat ? 'lead' : (room.verifiers ?? []).includes(id) ? 'verifier' : 'worker',
      roleKind: roleKindOf(id === room.leadSeat ? 'lead' : (room.verifiers ?? []).includes(id) ? 'verifier' : 'worker'),
      permissions: { read: false, exec: false, write: false },
      toolSurface: [],
      skills: [],
      mcp: [],
      body: { kind: 'base', ...(room.seatBots?.[id] === undefined ? {} : { ref: room.seatBots[id] }), name: room.seatNames?.[id] ?? id },
    }))
  return {
    ...room,
    members,
    leadMemberId: room.leadMemberId ?? room.leadSeat ?? members.find(member => member.role === 'lead')?.id ?? members[0]?.id ?? null,
    memberCursors: room.memberCursors ?? room.seatCursors ?? {},
  }
}
