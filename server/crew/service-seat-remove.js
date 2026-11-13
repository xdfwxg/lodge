import { fail, ok } from './result.js'

export const createSeatRemove = ({ store, engine, live, emit, roomFiles, workspace }) => {
  const { readRoom, updateRoom, appendMessage } = store

  const removeSeatFromRoom = async (room, seatId) => {
    if (room.demo === true) return fail('conflict', '演示房间不能移除席位')
    if (room.state !== 'active' && room.state !== 'paused') return fail('conflict', '房间结束后不能移除席位')
    const spec = (room.seatSpecs ?? []).find(seat => seat.id === seatId)
    if (spec === undefined) return fail('not_found', '没有这个席位')
    if (spec.role !== 'worker' && spec.role !== 'verifier') return fail('conflict', '只能移除执行或验收席位')
    if (spec.role === 'worker' && (room.workers ?? []).length <= 1) return fail('conflict', '至少要保留一个执行席位')
    if (spec.role === 'worker' && (room.workers ?? [])[0] === seatId) return fail('conflict', '交付席位不能直接移除；先完成或停止房间')
    if ((room.busySeats ?? []).includes(seatId) || room.busySeat === seatId) return fail('conflict', '这个席位正在跑回合，等结束后再移除')
    const seatWorkspace = workspace.provider(room)
    if (typeof seatWorkspace.removeSeat !== 'function') return fail('conflict', '当前工作区不支持移除席位')
    const base = room.seatRooms?.[seatId]
    const seatRefId = room.seatBots?.[seatId]
    if (typeof live.detachSeat === 'function') live.detachSeat(room.id, seatId)
    if (base !== undefined) await engine.deleteRoom?.(base.id).catch(() => {})
    if (seatRefId !== undefined) await engine.deleteSeatBot?.(seatRefId).catch(() => {})
    try {
      seatWorkspace.removeSeat({ room, seat: spec })
    } catch (error) {
      appendMessage(room.id, { kind: 'system', text: `席位工作区清理失败：${error?.message ?? error}` })
    }
    const updated = updateRoom(room.id, current => {
      current.seatSpecs = (current.seatSpecs ?? []).filter(seat => seat.id !== seatId)
      current.members = (current.members ?? []).filter(id => id !== seatId)
      current.workers = (current.workers ?? []).filter(id => id !== seatId)
      current.verifiers = (current.verifiers ?? []).filter(id => id !== seatId)
      for (const key of ['seatRooms', 'seatBots', 'seatNames', 'engines', 'models', 'worktrees', 'ports', 'workspaceEnv', 'branches', 'seatCursors', 'engineFallbacks']) {
        if (current[key] !== undefined) {
          const next = { ...current[key] }
          delete next[seatId]
          current[key] = next
        }
      }
      current.stages = (current.stages ?? []).map(stage => (
        Array.isArray(stage.tasks) ? { ...stage, tasks: stage.tasks.filter(task => task.owner !== seatId) } : stage
      ))
      if ((current.verifiers ?? []).length === 0) {
        current.independence = 'human'
      }
      return { events: [{ type: 'room.seat_removed', payload: { seat: seatId, role: spec.role } }] }
    })
    if (updated === null) return fail('not_found', '房间不在了')
    roomFiles.writeGoal(updated)
    try {
      await live.syncChatMembers?.(updated)
    } catch (error) {
      appendMessage(room.id, { kind: 'system', text: `席位已移除，但聊天群成员同步失败：${error?.message ?? error}` })
    }
    appendMessage(room.id, { kind: 'system', text: `已移除席位：${spec.name}` })
    emit('room', updated)
    return ok({ room: updated })
  }

  const removeSeat = (roomId, seatId) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    return removeSeatFromRoom(room, seatId)
  }

  return { removeSeatFromRoom, removeSeat }
}
