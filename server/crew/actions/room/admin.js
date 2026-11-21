import { fail, ok } from '../../result.js'

// 房间本体的动作：改名、归档、删除、成员与身体。
export const createAdminActions = deps => {
  const {
    live, emit, roomFiles, files, memberAdd, memberRemove, stopRound,
    readRoom, updateRoom, deleteRoom,
  } = deps

  return {
    rename: async ({ room, readBody }) => {
      const body = await readBody()
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (name === '' || Array.from(name).length > 60) return fail('invalid', '房间名不能为空，且不超过 60 字')
      const updated = updateRoom(room.id, current => {
        current.name = name
        return { events: [{ type: 'room.renamed', payload: { name } }] }
      })
      if (updated === null) return fail('not_found', '没有这个房间')
      emit('room', updated)
      return ok({ room: updated })
    },

    archive: async ({ room: input, readBody }) => {
      let room = input
      const body = await readBody()
      if (body.archived === false) {
        const restored = updateRoom(room.id, current => {
          current.archivedAt = null
          current.live = false
          if (current.state === 'stopped') {
            current.state = 'idle'
            current.idle = true
          }
          return { events: [{ type: 'room.restored' }] }
        })
        if (restored === null) return fail('not_found', '没有这个房间')
        emit('room', restored)
        return ok({ room: readRoom(room.id) ?? restored })
      }
      const wasLive = room.live === true && live.isAttached?.(room.id) === true
      const hadRound = typeof room.activeRoundId === 'string' && room.activeRoundId !== ''
      if (hadRound) {
        const stopped = await stopRound({ store: deps.store, live, emit, room, reason: '房间已归档' })
        if (stopped.ok !== true) return stopped
        room = readRoom(room.id) ?? room
      } else if (wasLive) {
        await live.cancel?.({ roomId: room.id })
        live.detach?.(room.id)
      }
      const archivedAt = Date.now()
      const updated = updateRoom(room.id, current => {
        current.archivedAt = archivedAt
        current.live = false
        if (hadRound || current.state === 'active') {
          current.state = 'stopped'
          current.idle = false
        }
        return { events: [{ type: 'room.archived', payload: { stopped: hadRound } }] }
      })
      if (updated === null) return fail('not_found', '没有这个房间')
      emit('room', updated)
      return ok({ room: updated })
    },

    delete: async ({ room }) => {
      if (room.state === 'active' || room.activeRoundId) return fail('conflict', '正在进行的房间不能删除；先归档再删除')
      if (room.live === true && live.isAttached?.(room.id) === true) live.detach?.(room.id)
      // 删房时把成员身体和隐藏 Bot 一起退役；工作区和用户文件留着。
      try {
        await live.retireRoomBots?.(room)
      } catch (error) {
        console.warn(`room bots retire failed: ${room.id} ${error?.message ?? error}`)
      }
      const removed = typeof deleteRoom === 'function' ? deleteRoom(room.id) : false
      if (removed !== true) return fail('not_found', '没有这个房间')
      // 只删房间自己的 .crew/rooms/<id> 过程档案；交付工作区和用户仓库不碰。
      const roomRoot = roomFiles.roomDir?.(room)
      if (typeof roomRoot === 'string' && roomRoot !== '') {
        try { files.remove(roomRoot) } catch (error) {
          console.warn(`room files remove failed: ${room.id} ${error?.message ?? error}`)
        }
      }
      emit('room.deleted', { id: room.id, name: room.name })
      return ok({ id: room.id })
    },

    // 添加成员与换身体允许在暂停时进行（例如模型登录失效后补人），不受暂停门禁限制。
    'add-member': async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '房间没有连上，不能加成员')
      return memberAdd.add(room, await readBody())
    },

    'remove-member': async ({ room, readBody }) => memberRemove.remove(room, await readBody()),

    'swap-body': async ({ room, readBody }) => {
      if (room.live !== true || typeof live.swapBody !== 'function') return fail('conflict', '当前房间不能调整成员')
      return live.swapBody(room, await readBody())
    },
  }
}
