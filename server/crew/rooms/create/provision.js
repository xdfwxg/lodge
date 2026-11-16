import { roomBulletin } from './input.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from '../../room-chat.js'
import { roomModeForType } from '../kinds.js'
import { roleKindOf } from '../../roster.js'

export const createProvisioner = ({ engine }) => {
  const createdMembers = []
  const createdBaseRooms = []
  let cleanupExtra = null

  const provision = async ({ roster, short, title, goal, handoff = null, verify, acceptance, align, workspaces, verifiers, roomType = 'studio' }) => {
    const mode = roomModeForType(roomType)
    let instances = []
    try {
      instances = await engine.instances()
    } catch {
      instances = []
    }
    const engineKind = id => instances.find(item => item.id === id)?.engine ?? id
    // 基座只有在驱动支持权限复核时才会把外部动作停下来问人；不支持就不能假装会问。
    const approvalGateOf = id => {
      const capabilities = instances.find(item => item.id === id)?.capabilities
      if (capabilities === undefined || capabilities === null) return undefined
      return capabilities.approvalReview === true
    }
    const kindOf = member => member.roleKind ?? roleKindOf(member.role)
    // 工人先建，验收成员才有事实可依；没有显式引擎时优先选不同厂商。
    const ordered = [...roster].sort((a, b) => (kindOf(a) === 'verifier' ? 1 : 0) - (kindOf(b) === 'verifier' ? 1 : 0))
    for (const member of ordered) {
      let requestedEngine = member.engine
      if (kindOf(member) === 'verifier' && member.engineExplicit !== true) {
        const workerKinds = new Set(createdMembers
          .filter(({ member: item }) => kindOf(item) === 'executor')
          .map(({ memberRef }) => engineKind(memberRef.engine)))
        const candidate = instances.find(item => item.available && !workerKinds.has(item.engine))
        if (candidate !== undefined) requestedEngine = candidate.id
      }
      const memberRef = await engine.createMemberBot({
        // 房间里的名字就是基座里的名字；id 才是稳定身份。
        name: member.name,
        soul: mode.memberSoul?.(member) ?? member.prompt,
        description: member.station,
        approval: member.approval,
        mcp: member.mcp,
        engine: requestedEngine,
        model: member.model,
      })
      createdMembers.push({ member, memberRef })
      if (Array.isArray(member.skills) && member.skills.length > 0) {
        try {
          await engine.setBotSkills(memberRef.id, member.skills)
        } catch (error) {
          throw new Error(`技能没挂上（${member.name}）：${error?.message ?? error}`)
        }
      }
    }
    const engineFallbacks = Object.fromEntries(createdMembers
      .filter(({ memberRef }) => memberRef.fallback === true)
      .map(({ member, memberRef }) => [member.id, { requested: memberRef.requestedEngine, actual: memberRef.engine, reason: memberRef.reason }]))
    const baseRoomFor = async (member, memberRef) => {
      const baseRoom = await engine.createRoom({
        name: `${title} · ${member.name}`,
        goal,
        bulletin: roomBulletin(goal, verify, acceptance, handoff),
        members: [memberRef.id],
        cwd: workspaces.members[member.id].path,
        leadId: memberRef.id,
      })
      createdBaseRooms.push(baseRoom)
      return baseRoom
    }
    const baseRooms = new Map()
    const engines = {}
    const models = {}
    for (const { member, memberRef } of createdMembers) {
      const baseRoom = await baseRoomFor(member, memberRef)
      baseRooms.set(member.id, baseRoom)
      engines[member.id] = memberRef.engine
      models[member.id] = memberRef.model
    }
    const leadMember = createdMembers.find(({ member }) => kindOf(member) === 'planner') ?? createdMembers[0]
    const extra = await mode.provisionExtra({ engine, short, workspaces, leadMember }) ?? null
    cleanupExtra = extra?.cleanup ?? null
    const extraMembers = extra?.members ?? []
    const chatMembers = [
      ...createdMembers.map(({ memberRef }) => memberRef.id),
      ...extraMembers,
    ]
    const chatRoom = await engine.createRoom({
      name: roomChatName(title),
      goal,
      bulletin: ROOM_CHAT_BULLETIN,
      members: chatMembers,
      cwd: workspaces.roomPath ?? workspaces.members[leadMember.member.id].path,
      leadId: extra?.leadId ?? leadMember.memberRef.id,
      responder: { kind: 'mentions' },
    })
    createdBaseRooms.push(chatRoom)
    const chatHost = extra?.chatHost ?? null

    const workerEngines = new Set(createdMembers
      .filter(({ member }) => kindOf(member) === 'executor')
      .map(({ memberRef }) => memberRef.engine))
    const verifierEngines = createdMembers
      .filter(({ member }) => kindOf(member) === 'verifier')
      .map(({ memberRef }) => memberRef.engine)
    const independence = verifiers.length === 0
      ? 'human'
      : verifierEngines.length > 0 && verifierEngines.every(id => (
        [...workerEngines].every(workerId => engineKind(workerId) !== engineKind(id))
      ))
        ? 'vendor'
        : 'none'
    const byId = new Map(createdMembers.map(item => [item.member.id, item]))
    const members = roster.map(member => {
      const { memberRef } = byId.get(member.id)
      const baseRoom = baseRooms.get(member.id)
      const approvalGate = approvalGateOf(memberRef.engine)
      return {
        id: member.id,
        kind: 'ai',
        name: member.name,
        title: member.title,
        role: member.role,
        roleKind: member.roleKind ?? kindOf(member),
        roleProfile: member.roleProfile,
        ...(member.isHost === true ? { isHost: true } : {}),
        station: member.station,
        engine: member.engine,
        ...(approvalGate === undefined ? {} : { approvalGate }),
        ...(member.model === undefined ? {} : { model: member.model }),
        permissions: member.permissions,
        writeScope: member.writeScope,
        toolSurface: member.toolSurface,
        skills: member.skills,
        mcp: member.mcp,
        approval: member.approval,
        speakBudget: member.speakBudget,
        ...(member.personality === undefined || member.personality === '' ? {} : { personality: member.personality }),
        body: {
          kind: 'base',
          ref: memberRef.id,
          name: memberRef.name,
          roomRef: baseRoom.id,
          sessionRef: baseRoom.sessionRef,
          engine: memberRef.engine,
          ...(memberRef.model === undefined ? {} : { model: memberRef.model }),
        },
      }
    })
    return { members, engines, models, engineFallbacks, independence, chatRoom, chatHost }
  }

  const cleanup = async () => {
    for (const baseRoom of createdBaseRooms) await engine.deleteRoom(baseRoom.id)
    for (const item of createdMembers) await engine.deleteMemberBot(item.memberRef.id)
    if (cleanupExtra !== null) await cleanupExtra()
  }

  return { provision, cleanup }
}
