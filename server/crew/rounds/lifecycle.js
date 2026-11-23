import { fail, ok } from '../result.js'
import { cancelOpenAssignments } from '../assignments.js'
import { transitionRound } from '../kernel/round.js'
import { startRound } from './start.js'

const settle = async ({
  store,
  live,
  emit,
  room,
  event,
  reason = '',
  patch = {},
  roomPatch = {},
  eventType = '',
  idempotencyKey = null,
  cancel = true,
}) => {
  const round = room?.workRound ?? null
  if (round === null) return ok({ room })
  const terminal = {
    complete: 'completed',
    reject: 'rejected',
    fail: 'failed',
    supersede: 'superseded',
    stop: 'stopped',
  }[event]
  if (terminal !== undefined && round.status === terminal) return ok({ room, round })
  const moved = transitionRound(round.status, event)
  if (!moved.ok) return fail('conflict', moved.error)
  if (cancel) {
    try { await live?.cancel?.({ roomId: room.id }) } catch {}
    try { live?.detach?.(room.id) } catch {}
    try { cancelOpenAssignments(store, room.id, { reason: reason === '' ? '这一轮结束了' : reason }) } catch {}
  }
  const finished = store.finishWorkRound?.({
    roomId: room.id,
    roundId: round.id,
    status: moved.state,
    patch: {
      ...(reason === '' ? {} : { stopReason: reason }),
      ...patch,
    },
    roomPatch,
    eventType,
    eventPayload: reason === '' ? {} : { reason },
    idempotencyKey,
  }) ?? null
  if (finished === null) return fail('conflict', '这一轮状态已经变化，重试')
  if (finished.round !== null && finished.round !== undefined) emit?.('round', finished.round)
  if (finished.room !== null && finished.room !== undefined) emit?.('room', finished.room)
  return ok({ room: finished.room, round: finished.round })
}

export const stopRound = ({ store, live, emit, room, reason = '' }) => settle({
  store,
  live,
  emit,
  room,
  event: 'stop',
  reason,
  eventType: 'round.stopped',
  idempotencyKey: `round-stop:${room?.workRound?.id ?? room?.id}`,
})

// 停下的一轮接回来：只恢复这一轮和目标，不新建、不改目标；阶段与证据原样保留。
export const resumeRound = ({ store, live, emit, room }) => {
  const round = room?.workRound ?? null
  if (round === null) return fail('conflict', '这一轮还没有开始')
  if (round.status !== 'stopped') return fail('conflict', '这一轮没有停下')
  const moved = transitionRound(round.status, 'resume')
  if (!moved.ok) return fail('conflict', moved.error)
  const reopened = store.reopenWorkRound?.({ roomId: room.id, roundId: round.id }) ?? null
  if (reopened === null) return fail('conflict', '这一轮状态已经变化，重试')
  if (reopened.round !== null && reopened.round !== undefined) emit?.('round', reopened.round)
  if (reopened.room !== null && reopened.room !== undefined) emit?.('room', reopened.room)
  return ok({ room: reopened.room, round: reopened.round })
}

export const rejectRound = ({ store, live, emit, room, reason = '' }) => settle({
  store,
  live,
  emit,
  room,
  event: 'reject',
  reason,
  eventType: 'round.rejected',
  idempotencyKey: `round-reject:${room?.workRound?.id ?? room?.id}`,
})

export const failRound = ({ store, live, emit, room, reason = '' }) => settle({
  store,
  live,
  emit,
  room,
  event: 'fail',
  reason,
  eventType: 'round.failed',
  idempotencyKey: `round-fail:${room?.workRound?.id ?? room?.id}`,
})

export const supersedeRound = async ({ store, live, emit, room, body = {}, roomFiles = null }) => {
  const round = room?.workRound ?? null
  if (round === null) return fail('conflict', '这一轮还没有开始')
  if (typeof body?.goal !== 'string' || body.goal.trim() === '') {
    return fail('invalid', '换目标时要写清新目标')
  }
  const settled = await settle({
    store,
    live,
    emit,
    room,
    event: 'supersede',
    reason: typeof body.reason === 'string' ? body.reason : '目标变了',
    eventType: 'round.superseded',
    idempotencyKey: `round-supersede:${round.id}`,
  })
  if (settled.ok !== true) return settled
  const refreshed = store.readRoom(room.id) ?? room
  return startRound({ store, live, emit, room: refreshed, body, roomFiles })
}
