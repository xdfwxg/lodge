import { roomBulletin } from './room-create-input.js'
import { ROOM_CHAT_BULLETIN, roomChatName } from './room-chat.js'

export const createProvisioner = ({ engine }) => {
  const createdSeatRefs = []
  const createdBaseRooms = []

  const provision = async ({ roster, short, title, goal, verify, acceptance, align, workspaces, verifiers }) => {
    let instances = []
    try {
      instances = await engine.instances()
    } catch {
      instances = []
    }
    const engineKind = id => instances.find(item => item.id === id)?.engine ?? id
    // 工人先建，验收席位才有事实可依；没有显式引擎时优先选不同厂商。
    const ordered = [...roster].sort((a, b) => (a.role === 'verifier' ? 1 : 0) - (b.role === 'verifier' ? 1 : 0))
    for (const seat of ordered) {
      let requestedEngine = seat.engine
      if (seat.role === 'verifier' && seat.engineExplicit !== true) {
        const workerKinds = new Set(createdSeatRefs
          .filter(({ seat: item }) => item.role === 'worker')
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
        engine: requestedEngine,
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
        bulletin: roomBulletin(goal, verify, acceptance, align),
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
    for (const { seat, seatRef } of createdSeatRefs) {
      const baseRoom = await baseRoomFor(seat, seatRef)
      seatRooms[seat.id] = { id: baseRoom.id, sessionRef: baseRoom.sessionRef }
      seatBots[seat.id] = seatRef.id
      seatNames[seat.id] = seatRef.name
      engines[seat.id] = seatRef.engine
    }
    const leadSeat = createdSeatRefs.find(({ seat }) => seat.role === 'lead') ?? createdSeatRefs[0]
    const chatRoom = await engine.createRoom({
      name: roomChatName(title),
      goal,
      bulletin: ROOM_CHAT_BULLETIN,
      members: createdSeatRefs.map(({ seatRef }) => seatRef.id),
      cwd: workspaces.roomPath ?? workspaces.seats[leadSeat.seat.id].path,
      leadId: leadSeat.seatRef.id,
      autoRoute: true,
    })
    createdBaseRooms.push(chatRoom)

    const workerEngines = new Set(createdSeatRefs
      .filter(({ seat }) => seat.role === 'worker')
      .map(({ seatRef }) => seatRef.engine))
    const verifierEngines = createdSeatRefs
      .filter(({ seat }) => seat.role === 'verifier')
      .map(({ seatRef }) => seatRef.engine)
    const independence = verifiers.length === 0
      ? 'human'
      : verifierEngines.length > 0 && verifierEngines.every(id => (
        [...workerEngines].every(workerId => engineKind(workerId) !== engineKind(id))
      ))
        ? 'vendor'
        : 'none'
    return { seatRooms, seatBots, seatNames, engines, engineFallbacks, independence, chatRoom }
  }

  const cleanup = async () => {
    for (const baseRoom of createdBaseRooms) await engine.deleteRoom(baseRoom.id)
    for (const item of createdSeatRefs) await engine.deleteSeatBot(item.seatRef.id)
  }

  return { provision, cleanup }
}
