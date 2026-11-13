import { roomBulletin } from './room-create-input.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from './room-chat.js'
import { roleKindOf } from './seats.js'

export const createProvisioner = ({ engine }) => {
  const createdSeatRefs = []
  const createdBaseRooms = []
  let createdHostRef = null

  const provision = async ({ roster, short, title, goal, verify, acceptance, align, workspaces, verifiers, roomType = 'studio', leadToolServers = [] }) => {
    let instances = []
    try {
      instances = await engine.instances()
    } catch {
      instances = []
    }
    const engineKind = id => instances.find(item => item.id === id)?.engine ?? id
    const kindOf = seat => seat.roleKind ?? roleKindOf(seat.role)
    // 工人先建，验收席位才有事实可依；没有显式引擎时优先选不同厂商。
    const ordered = [...roster].sort((a, b) => (kindOf(a) === 'verifier' ? 1 : 0) - (kindOf(b) === 'verifier' ? 1 : 0))
    for (const seat of ordered) {
      let requestedEngine = seat.engine
      if (kindOf(seat) === 'verifier' && seat.engineExplicit !== true) {
        const workerKinds = new Set(createdSeatRefs
          .filter(({ seat: item }) => kindOf(item) === 'executor')
          .map(({ seatRef }) => engineKind(seatRef.engine)))
        const candidate = instances.find(item => item.available && !workerKinds.has(item.engine))
        if (candidate !== undefined) requestedEngine = candidate.id
      }
      const seatRef = await engine.createSeatBot({
        name: `${seat.id[0].toUpperCase()}${seat.id.slice(1)}${short}`,
        soul: seat.prompt,
        description: seat.station,
        approval: seat.approval,
        mcp: seat.mcp,
        roomTools: kindOf(seat) === 'planner' ? leadToolServers : [],
        engine: requestedEngine,
        model: seat.model,
      })
      createdSeatRefs.push({ seat, seatRef })
    }
    const engineFallbacks = Object.fromEntries(createdSeatRefs
      .filter(({ seatRef }) => seatRef.fallback === true)
      .map(({ seat, seatRef }) => [seat.id, { requested: seatRef.requestedEngine, actual: seatRef.engine, reason: seatRef.reason }]))
    const baseRoomFor = async (seat, seatRef) => {
      const baseRoom = await engine.createRoom({
        name: `${title} · ${seat.name}`,
        goal,
        bulletin: roomBulletin(goal, verify, acceptance),
        members: [seatRef.id],
        cwd: workspaces.seats[seat.id].path,
        leadId: seatRef.id,
      })
      createdBaseRooms.push(baseRoom)
      return baseRoom
    }
    const seatRooms = {}
    const seatBots = {}
    const seatNames = {}
    const engines = {}
    const models = {}
    for (const { seat, seatRef } of createdSeatRefs) {
      const baseRoom = await baseRoomFor(seat, seatRef)
      seatRooms[seat.id] = { id: baseRoom.id, sessionRef: baseRoom.sessionRef }
      seatBots[seat.id] = seatRef.id
      seatNames[seat.id] = seatRef.name
      engines[seat.id] = seatRef.engine
      models[seat.id] = seatRef.model
    }
    const leadSeat = createdSeatRefs.find(({ seat }) => kindOf(seat) === 'planner') ?? createdSeatRefs[0]
    // 聊天室的主持人是 Lodge 自己：单独建一个不出现在席位里的主持模型，只用来开场和总结。
    createdHostRef = roomType === 'chat'
      ? await engine.createSeatBot({
        name: `LodgeHost${short}`,
        soul: '你是 Lodge 的主持人。你只负责开场、总结和收敛讨论，不替发言者下结论；不要调用工具。',
        approval: 'ask',
      })
      : null
    const chatMembers = [
      ...createdSeatRefs.map(({ seatRef }) => seatRef.id),
      ...(createdHostRef === null ? [] : [createdHostRef.id]),
    ]
    const chatRoom = await engine.createRoom({
      name: roomChatName(title),
      goal,
      bulletin: ROOM_CHAT_BULLETIN,
      members: chatMembers,
      cwd: workspaces.roomPath ?? workspaces.seats[leadSeat.seat.id].path,
      leadId: createdHostRef?.id ?? leadSeat.seatRef.id,
      responder: { kind: 'mentions' },
    })
    createdBaseRooms.push(chatRoom)
    const chatHost = createdHostRef === null
      ? null
      : { memberRef: createdHostRef.id, name: createdHostRef.name }

    const workerEngines = new Set(createdSeatRefs
      .filter(({ seat }) => kindOf(seat) === 'executor')
      .map(({ seatRef }) => seatRef.engine))
    const verifierEngines = createdSeatRefs
      .filter(({ seat }) => kindOf(seat) === 'verifier')
      .map(({ seatRef }) => seatRef.engine)
    const independence = verifiers.length === 0
      ? 'human'
      : verifierEngines.length > 0 && verifierEngines.every(id => (
        [...workerEngines].every(workerId => engineKind(workerId) !== engineKind(id))
      ))
        ? 'vendor'
        : 'none'
    return { seatRooms, seatBots, seatNames, engines, models, engineFallbacks, independence, chatRoom, chatHost }
  }

  const cleanup = async () => {
    for (const baseRoom of createdBaseRooms) await engine.deleteRoom(baseRoom.id)
    for (const item of createdSeatRefs) await engine.deleteSeatBot(item.seatRef.id)
    if (createdHostRef !== null) await engine.deleteSeatBot(createdHostRef.id)
  }

  return { provision, cleanup }
}
