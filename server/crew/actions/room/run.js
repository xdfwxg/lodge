import { memberOf } from '../../room-members.js'
import { accepted, BusinessError, fail, ok } from '../../result.js'
import { cancelOpenAssignments } from '../../assignments.js'
import { ROOM_STATE } from '../../../../shared/states.js'

// 运行中的动作：确认、恢复、停下当前回合、复核、排队和叫停成员。
export const createRunActions = deps => {
  const { store, live, emit, stages, readRoom } = deps

  return {
    approvals: async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间有待确认的操作')
      if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const approvalId = typeof body.id === 'string' ? body.id : ''
      const decision = body.decision === 'allow' ? 'allow' : body.decision === 'deny' ? 'deny' : ''
      if (approvalId === '') return fail('invalid', '缺少要确认的操作')
      if (decision === '') return fail('invalid', '这个操作只能选“可以做”或“先别做”')
      const result = await live.decideApproval(room.id, approvalId, decision)
      if (result.ok !== true) return fail('conflict', result.reason)
      return ok({ room: result.room })
    },

    resume: async ({ room, readBody }) => {
      const disconnected = typeof room.connectionError === 'string' && room.connectionError !== ''
      if (room.state !== ROOM_STATE.paused && !disconnected) return fail('conflict', '房间没有暂停')
      if (room.live !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      if (live.isAttached?.(room.id) !== true) {
        try {
          await live.attach?.(room)
        } catch {
          return fail('conflict', '房间现在没有连上，稍后再试')
        }
      }
      const resumed = deps.updateRoom(room.id, current => {
        const events = []
        if (current.state === ROOM_STATE.paused) {
          current.state = ROOM_STATE.active
          current.idle = false
          current.pauseReason = null
          current.noProgress = 0
          events.push({ type: 'room.resumed' })
        }
        if (typeof current.connectionError === 'string' && current.connectionError !== '') {
          delete current.connectionError
          events.push({ type: 'room.connection', payload: { connected: true } })
        }
        return events.length === 0 ? null : { events }
      })
      if (resumed === null) return fail('not_found', '没有这个房间')
      emit('room', resumed)
      if (room.state === ROOM_STATE.paused) {
        try { await live.resume?.(room.id) } catch (error) {
          console.warn(`room resume failed: ${room.id} ${error?.message ?? error}`)
        }
      }
      return ok({ room: readRoom(room.id) ?? resumed })
    },

    // 输入条上的方块只停下这次回复，不把房间变成暂停态；停完可以直接说下一步。
    interrupt: async ({ room }) => {
      if (room.state !== ROOM_STATE.active) return fail('conflict', '房间没有在跑')
      if (room.live !== true || live.isAttached?.(room.id) !== true) {
        return fail('conflict', '房间现在没有连上，稍后再试')
      }
      const cancelled = await live.cancel?.({ roomId: room.id })
      const cancelledAssignments = room.roomType === 'studio'
        ? cancelOpenAssignments(store, room.id, { reason: '用户停下了这次回复' })
        : 0
      const updated = readRoom(room.id) ?? room
      emit('room', updated)
      return ok({
        room: updated,
        cancelled: cancelled?.cancelled === true,
        assignments: cancelledAssignments,
      })
    },

    acceptance: async ({ room, readBody }) => {
      const body = await readBody()
      return stages.setAcceptance(room, Number(body.stage), typeof body.command === 'string' ? body.command : '')
    },

    verify: async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能真的检查；示例房间用示例数据')
      if (live.isAttached(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      try {
        return accepted(await live.requestReview(room.id, Number(body.stage)))
      } catch (error) {
        if (error instanceof BusinessError) return fail(error.reason, error.message)
        throw error
      }
    },

    read: async ({ roomId, room }) => {
      if (room.live === true && typeof live.markChatRead === 'function') await live.markChatRead(room)
      return ok({ room: readRoom(roomId) ?? room })
    },

    'answer-card': async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能回答问题')
      if (live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const memberId = typeof body.memberId === 'string' ? body.memberId : ''
      const requestId = typeof body.requestId === 'string' ? body.requestId : ''
      const message = typeof body.message === 'string' ? body.message : ''
      const result = await live.answerCard(room.id, memberId, requestId, message)
      if (result.ok !== true) return fail('conflict', result.reason)
      return ok({ room: result.room })
    },

    'cancel-queue': async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能撤回排队消息')
      const body = await readBody()
      const queueId = typeof body.queueId === 'string' ? body.queueId : ''
      if (queueId === '') return fail('invalid', '缺少排队消息')
      try {
        const result = await live.cancelQueued(room.id, queueId)
        return result.cancelled === true ? ok(result) : fail('conflict', result.reason)
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
    },

    steer: async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能插话')
      if (live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const queueId = typeof body.queueId === 'string' ? body.queueId : ''
      if (queueId === '') return fail('invalid', '缺少排队消息')
      try {
        return ok(await live.steerQueued(room.id, queueId))
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
    },

    hold: async ({ room, readBody }) => {
      if (room.live !== true) return fail('conflict', '只有正在运行的房间能叫停成员')
      if (live.isAttached?.(room.id) !== true) return fail('conflict', '房间现在没有连上，稍后再试')
      const body = await readBody()
      const memberId = typeof body.memberId === 'string' ? body.memberId : ''
      if (memberOf(room, memberId) === null) return fail('invalid', '没有这个成员')
      try {
        const updated = await live.holdMember(room.id, memberId, body.held === true)
        return ok({ room: updated ?? readRoom(room.id) ?? room })
      } catch (error) {
        return fail('conflict', String(error?.message ?? error))
      }
    },
  }
}
