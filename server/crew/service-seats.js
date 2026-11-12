import { fail, ok } from './result.js'
import { createSeatAdd } from './service-seat-add.js'
import { createSeatRemove } from './service-seat-remove.js'

export const createServiceSeats = ({ store, engine, live, emit, roomFiles, workspace }) => {
  const { readRoom } = store
  const add = createSeatAdd({ store, engine, live, emit, roomFiles, workspace })
  const remove = createSeatRemove({ store, engine, live, emit, roomFiles, workspace })

  // 改角色不是独立业务单元，只是加/移除席位的编排。
  const changeSeatRole = async (roomId, seatId, role) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.imported === true || room.demo === true) return fail('conflict', '这个房间不能改角色')
    if (room.state !== 'paused') return fail('conflict', '先暂停房间，再改席位角色')
    if (role !== 'worker' && role !== 'verifier') return fail('invalid', '只能改成执行或验收席位')
    const spec = (room.seatSpecs ?? []).find(seat => seat.id === seatId)
    if (spec === undefined) return fail('not_found', '没有这个席位')
    if (spec.role === role) return ok({ room })
    if (spec.role === 'worker' && (room.workers ?? [])[0] === seatId) {
      return fail('conflict', '交付席位不能直接改角色；先完成或停止房间')
    }
    const oldIds = new Set((room.seatSpecs ?? []).map(seat => seat.id))
    const added = await add.addSeat(room, { role, name: spec.name })
    if (added.ok !== true) return added
    const addedRoom = readRoom(roomId)
    const newSpec = (addedRoom.seatSpecs ?? []).find(seat => !oldIds.has(seat.id))
    const removed = await remove.removeSeatFromRoom(addedRoom, seatId)
    if (removed.ok !== true) {
      if (newSpec !== undefined) await remove.removeSeatFromRoom(readRoom(roomId), newSpec.id)
      return removed
    }
    return removed
  }

  return {
    addSeat: add.addSeat,
    removeSeatFromRoom: remove.removeSeatFromRoom,
    removeSeat: remove.removeSeat,
    changeSeatRole,
  }
}
