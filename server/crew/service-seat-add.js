import { fail, ok } from './result.js'
import { rosterFromRoles, validateRoster } from './seats.js'

export const createSeatAdd = ({ store, engine, live, emit, roomFiles, workspace }) => {
  const { updateRoom, appendMessage } = store

  // 建后加席位：工作区、基座席位线程、实时订阅和房间数组一起更新。
  const addSeat = async (room, body) => {
    if (room.imported === true) return fail('conflict', '交接记录只读')
    if (room.demo === true) return fail('conflict', '演示房间不能加席位')
    if (room.state !== 'active' && room.state !== 'paused') return fail('conflict', '房间结束后不能加席位')
    const role = body?.role === 'worker' || body?.role === 'verifier' ? body.role : ''
    if (role === '') return fail('invalid', '只能添加执行或验收席位')
    const specs = Array.isArray(room.seatSpecs) ? room.seatSpecs : []
    if (specs.length >= 8) return fail('conflict', '一个房间最多 8 个席位')
    const baseSeat = rosterFromRoles([{
      role,
      name: typeof body?.name === 'string' ? body.name : '',
    }])[0]
    const count = specs.filter(seat => seat.role === role).length
    const id = count === 0 ? role : `${role}-${count + 1}`
    const seat = { ...baseSeat, id }
    try {
      validateRoster([...specs, seat])
    } catch (error) {
      return fail('invalid', `席位不可用：${error?.message ?? error}`)
    }
    const seatWorkspace = workspace.provider(room)
    if (typeof seatWorkspace.addSeat !== 'function') return fail('conflict', '当前工作区不支持建后加席位')
    if (role === 'worker' && seatWorkspace.capabilities().merge !== true) {
      return fail('conflict', '当前工作区只能有一个执行席位')
    }
    const placement = seatWorkspace.addSeat({ room, seat })
    workspace.writeSeatEnv({ room, seatId: id, path: placement.path, port: placement.port })

    let requestedEngine = typeof body?.engine === 'string' && body.engine !== ''
      ? body.engine
      : seat.engineExplicit === true ? seat.engine : undefined
    if (role === 'verifier' && seat.engineExplicit !== true) {
      try {
        const instances = await engine.instances()
        const workerKinds = new Set((room.workers ?? []).map(worker => (
          instances.find(item => item.id === room.engines?.[worker])?.engine ?? room.engines?.[worker]
        )))
        const candidate = instances.find(item => item.available && !workerKinds.has(item.engine))
        if (candidate !== undefined) requestedEngine = candidate.id
      } catch {}
    }

    let seatRef = null
    let baseRoom = null
    try {
      seatRef = await engine.createSeatBot({
        name: `${id[0].toUpperCase()}${id.slice(1)}${room.id.slice(-6)}`,
        soul: seat.prompt,
        description: seat.station,
        approval: seat.approval,
        mcp: seat.mcp,
        engine: requestedEngine,
      })
      baseRoom = await engine.createRoom({
        name: `${room.name} · ${seat.name}`,
        goal: room.goal,
        bulletin: `目标：${room.goal}\n验收：${room.stages.map(stage => stage.acceptance).filter(Boolean).join(' / ') || '人确认'}`,
        members: [seatRef.id],
        cwd: placement.path,
        leadId: seatRef.id,
      })
    } catch (error) {
      if (baseRoom !== null) await engine.deleteRoom?.(baseRoom.id).catch(() => {})
      if (seatRef !== null) await engine.deleteSeatBot?.(seatRef.id).catch(() => {})
      throw error
    }

    const publicSpec = {
      id: seat.id,
      name: seat.name,
      title: seat.title,
      role: seat.role,
      station: seat.station,
      permissions: seat.permissions,
      writeScope: seat.writeScope,
      toolSurface: seat.toolSurface,
      skills: seat.skills,
      mcp: seat.mcp,
      approval: seat.approval,
      speakBudget: seat.speakBudget,
    }
    const updated = updateRoom(room.id, current => {
      current.seatSpecs = [...(current.seatSpecs ?? []), publicSpec]
      current.members = [...new Set([...(current.members ?? []), seat.id])]
      if (role === 'worker') current.workers = [...new Set([...(current.workers ?? []), seat.id])]
      else current.verifiers = [...new Set([...(current.verifiers ?? []), seat.id])]
      current.seatRooms = { ...(current.seatRooms ?? {}), [seat.id]: { id: baseRoom.id, sessionRef: baseRoom.sessionRef } }
      current.seatBots = { ...(current.seatBots ?? {}), [seat.id]: seatRef.id }
      current.seatNames = { ...(current.seatNames ?? {}), [seat.id]: seatRef.name }
      current.engines = { ...(current.engines ?? {}), [seat.id]: seatRef.engine }
      current.worktrees = { ...(current.worktrees ?? {}), [seat.id]: placement.path }
      current.ports = { ...(current.ports ?? {}), [seat.id]: placement.port }
      current.workspaceEnv = { ...(current.workspaceEnv ?? {}), [seat.id]: placement.environment }
      if (placement.branch !== null) current.branches = { ...(current.branches ?? {}), [seat.id]: placement.branch }
      current.seatCursors = { ...(current.seatCursors ?? {}), [seat.id]: 0 }
      if (seatRef.fallback === true) {
        current.engineFallbacks = {
          ...(current.engineFallbacks ?? {}),
          [seat.id]: { requested: seatRef.requestedEngine, actual: seatRef.engine, reason: seatRef.reason },
        }
      }
      if (role === 'verifier' && (current.verifiers ?? []).length === 1) current.independence = 'none'
      return { events: [{ type: 'room.seat_added', payload: { seat: seat.id, role, path: placement.path } }] }
    })
    if (updated === null) {
      await engine.deleteRoom?.(baseRoom.id).catch(() => {})
      await engine.deleteSeatBot?.(seatRef.id).catch(() => {})
      return fail('not_found', '房间不在了，席位没有加入')
    }
    if (typeof live.attachSeat === 'function') {
      try {
        await live.attachSeat(room.id, seat.id)
      } catch (error) {
        appendMessage(room.id, { kind: 'system', text: `席位已加入，但实时订阅失败：${error?.message ?? error}` })
      }
    }
    roomFiles.writeGoal(updated)
    appendMessage(room.id, {
      kind: 'system',
      text: `已加入${role === 'verifier' ? '验收' : '执行'}席位：${seat.name}（工作区 ${placement.path}）`,
    })
    emit('room', updated)
    return ok({ room: updated })
  }

  return { addSeat }
}
