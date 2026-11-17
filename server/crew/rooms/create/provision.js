import { engineReady } from '../../../../shared/engine-readiness.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from '../../room-chat.js'
import { createBodyFactory } from '../../body.js'
import { roomBulletin, roomModeForType } from '../kinds.js'
import { roleKindOf } from '../../roster.js'
import { independenceOf } from '../../independence.js'

export const createProvisioner = ({ engine }) => {
  const bodies = createBodyFactory({ engine })
  const created = []
  const createdRooms = []
  let cleanupExtra = null

  const provision = async ({ roster, short, title, goal, handoff = null, verify, acceptance, workspaces, roomType = 'studio', shadowReview = false }) => {
    const mode = roomModeForType(roomType)
    const instances = await bodies.instances()
    const engineKind = id => instances.find(item => item.id === id)?.engine ?? id
    // 基座只有在驱动支持权限复核时才会把外部动作停下来问人；不支持就不能假装会问。
    const approvalGateOf = id => {
      const instance = instances.find(item => item.id === id)
      return instance === undefined ? undefined : engineReady(instance, { requireApproval: true })
    }
    const kindOf = member => member.roleKind ?? roleKindOf(member.role)
    // 工人先建，验收成员才有事实可依；没有显式引擎时优先选不同厂商。
    const ordered = [...roster].sort((a, b) => (kindOf(a) === 'verifier' ? 1 : 0) - (kindOf(b) === 'verifier' ? 1 : 0))
    for (const member of ordered) {
      let requestedEngine = member.engine
      if (kindOf(member) === 'verifier' && member.engineExplicit !== true) {
        const workerKinds = new Set(created
          .filter(({ member: item }) => kindOf(item) === 'executor')
          .map(({ body }) => engineKind(body.engine)))
        const candidate = instances.find(item => item.available && !workerKinds.has(item.engine))
        if (candidate !== undefined) requestedEngine = candidate.id
      }
      const incarnation = await bodies.incarnate({
        member,
        config: {
          engine: requestedEngine,
          model: member.model,
          soul: mode.memberSoul?.(member) ?? member.prompt,
          spec: {
            prompt: roomType === 'chat' ? '' : (member.prompt ?? ''),
            skills: member.skills ?? [],
            mcp: member.mcp ?? [],
          },
        },
        thread: {
          name: `${title} · ${member.name}`,
          goal,
          bulletin: roomBulletin(goal, verify, acceptance, handoff),
          cwd: workspaces.members[member.id].path,
        },
      })
      created.push({ member, memberRef: incarnation.memberRef, body: incarnation.body })
    }
    // 身体体检：只读基座表示的可用性，建房前就把没装好或没登录的身体拦下来。
    const bodyIssues = created.map(({ member, body }) => ({
      member,
      issue: bodies.healthOf(body.engine, instances),
    }))
    const engineFallbacks = Object.fromEntries(created
      .filter(({ memberRef }) => memberRef.fallback === true)
      .map(({ member, memberRef }) => [member.id, { requested: memberRef.requestedEngine, actual: memberRef.engine, reason: memberRef.reason }]))
    const leadMember = created.find(({ member }) => kindOf(member) === 'planner') ?? created[0]
    const extra = await mode.provisionExtra({ host: bodies, short, workspaces, leadMember, shadowReview }) ?? null
    cleanupExtra = extra?.cleanup ?? null
    const extraMembers = extra?.members ?? []
    const chatMembers = [
      ...created.map(({ memberRef }) => memberRef.id),
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
    createdRooms.push(chatRoom)
    const chatHost = extra?.chatHost ?? null

    const independence = independenceOf({
      members: created.map(({ member, body }) => ({
        id: member.id,
        role: member.role,
        roleKind: kindOf(member),
        body,
      })),
      instances,
    })
    const approvalGates = Object.fromEntries(created.map(({ member, body }) => [member.id, approvalGateOf(body.engine)]))
    const byId = new Map(created.map(item => [item.member.id, item]))
    const members = roster.map(member => {
      const { body } = byId.get(member.id)
      return {
        id: member.id,
        name: member.name,
        title: member.title,
        role: member.role,
        roleKind: member.roleKind ?? kindOf(member),
        roleProfile: member.roleProfile,
        ...(member.isHost === true ? { isHost: true } : {}),
        station: member.station,
        permissions: member.permissions,
        writeScope: member.writeScope,
        toolSurface: member.toolSurface,
        approval: member.approval,
        ...(member.personality === undefined || member.personality === '' ? {} : { personality: member.personality }),
        body,
      }
    })
    return {
      members,
      approvalGates,
      engineFallbacks,
      independence,
      chatRoom,
      chatHost,
      bodyIssues,
      shadowBot: extra?.shadowBot ?? null,
    }
  }

  const cleanup = async () => {
    for (const { body } of created) await bodies.retire(body)
    for (const room of createdRooms) await engine.deleteRoom?.(room.id)
    if (cleanupExtra !== null) await cleanupExtra()
  }

  return { provision, cleanup }
}
