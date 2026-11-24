import { engineReady } from '../../../../shared/engine-readiness.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from '../../room-chat.js'
import { createBodyFactory } from '../../body.js'
import { roomBulletin, roomModeForType } from '../kinds.js'
import { roleKindOf } from '../../roster.js'
import { independenceOf } from '../../independence.js'

// 验收员先要眼睛：有声明能看图的实例就先选它，其中再优先不同厂商；
// 没有能看图的，才退回跨厂商独立复核。两者只能保一个时，先保有眼睛。
export const pickVerifierEngine = (instances, workerKinds) => {
  const available = (instances ?? []).filter(item => item?.available === true)
  const vision = available.filter(item => item?.capabilities?.images === true)
  const chosen = vision.find(item => !workerKinds.has(item.engine)) ??
    vision[0] ??
    available.find(item => !workerKinds.has(item.engine)) ??
    null
  return chosen?.id ?? null
}

export const createProvisioner = ({ engine }) => {
  const bodies = createBodyFactory({ engine })
  const created = []
  const createdRooms = []
  let cleanupExtra = null

  const provision = async ({ roster, short, title, goal, handoffBrief = null, workspaces, roomType = 'studio', shadowReview = false, align = false }) => {
    const mode = roomModeForType(roomType)
    const instances = await bodies.instances()
    const engineKind = id => instances.find(item => item.id === id)?.engine ?? id
    // 基座只有在驱动支持权限复核时才会把外部动作停下来问人；不支持就不能假装会问。
    const approvalGateOf = id => {
      const instance = instances.find(item => item.id === id)
      return instance === undefined ? undefined : engineReady(instance, { requireApproval: true })
    }
    const kindOf = member => member.roleKind ?? roleKindOf(member.role)
    // 工人先建，验收员才有事实可依；没有显式引擎时优先选不同厂商。
    const ordered = [...roster].sort((a, b) => (kindOf(a) === 'verifier' ? 1 : 0) - (kindOf(b) === 'verifier' ? 1 : 0))
    for (const member of ordered) {
      let requestedEngine = member.engine
      if (kindOf(member) === 'verifier' && member.engineExplicit !== true) {
        const workerKinds = new Set(created
          .filter(({ member: item }) => kindOf(item) === 'executor')
          .map(({ body }) => engineKind(body.engine)))
        const candidateId = pickVerifierEngine(instances, workerKinds)
        if (candidateId !== null) requestedEngine = candidateId
      }
      const incarnation = await bodies.incarnate({
        member,
        config: {
          engine: requestedEngine,
          model: member.model,
          soul: mode.memberSoul?.(member) ?? member.prompt,
          spec: {
            prompt: mode.memberPrompt?.(member) ?? '',
            skills: member.skills ?? [],
            mcp: member.mcp ?? [],
          },
        },
        thread: {
          name: `${title} · ${member.name}`,
          goal,
          bulletin: roomBulletin(goal, handoffBrief),
          cwd: workspaces.members[member.id].path,
        },
      })
      // 身体声明它自己能做什么；这是声明，不是验证过的能力。
      const instance = instances.find(item => item.id === incarnation.body.engine)
      const body = instance === undefined
        ? incarnation.body
        : {
          ...incarnation.body,
          capabilities: {
            images: instance.capabilities?.images === true,
            tools: {
              read: member.permissions?.read === true,
              write: member.permissions?.write === true,
              exec: member.permissions?.exec === true,
            },
          },
        }
      created.push({ member, memberRef: incarnation.memberRef, body })
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
    // 先对齐的工作室只让规划师进基座群聊：对齐回合不会被 @ 叫起别人；派活前再放回全员。
    const chatMembers = align === true
      ? [leadMember.memberRef.id]
      : [...created.map(({ memberRef }) => memberRef.id), ...extraMembers]
    const chatRoom = await engine.createRoom({
      name: roomChatName(title),
      goal,
      bulletin: ROOM_CHAT_BULLETIN,
      members: chatMembers,
      cwd: workspaces.roomPath ?? workspaces.members[leadMember.member.id].path,
      leadId: extra?.leadId ?? leadMember.memberRef.id,
      responder: { kind: 'mentions' },
      // 两种房间都由系统点名；成员回复里的 @ 不决定下一棒。
      followMentions: false,
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
        ...(member.voice === undefined || member.voice === '' ? {} : { voice: member.voice }),
        ...(member.personality === undefined || member.personality === '' ? {} : { personality: member.personality }),
        ...(member.stance === undefined || member.stance === '' ? {} : { stance: member.stance }),
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
