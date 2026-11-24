import { OPEN_ROUND_STATUSES, ROOM_STATE } from '../../../shared/states.js'
import { PROMISE_STATUS, nextPromiseRunAt } from '../../../shared/promise.js'
import { promiseOf } from './contract.js'
import { armPromise } from './queue.js'

const isBusy = room => (
  room.state === ROOM_STATE.active ||
  (typeof room.activeRoundId === 'string' && room.activeRoundId !== '') ||
  OPEN_ROUND_STATUSES.has(room.workRound?.status)
)

const notice = (store, roomId, text, show = true) => store.appendMessage?.(roomId, {
  kind: 'system',
  text,
  meta: { kind: 'notice', show },
})

const updatePromise = ({ store, roomId, promise, patch, type, payload }) => store.updateRoom(roomId, current => {
  // 手改或另一次运行先写了，就不覆盖；下一次到点会自己接上。
  if (current.promise?.version !== promise.version) return null
  current.promise = {
    ...current.promise,
    ...patch,
    updatedAt: Date.now(),
    version: promise.version + 1,
  }
  return { events: [{ type, payload }] }
})

// 到点只做一件事：把“说好的事”变成房间的一轮；房间忙就改下一次，不排队、不重跑。
export const createPromiseRunner = ({ store, live, emit, startRound, roomFiles }) => async event => {
  const room = store.readRoom(event.roomId)
  if (room === null || room.archivedAt) return true
  const promise = promiseOf(room)
  if (promise === null || promise.status !== PROMISE_STATUS.active) return true
  const manual = event.payload?.manual === true
  const at = Number(event.payload?.at)
  if (!manual && (!Number.isFinite(at) || at !== promise.nextAt)) return true

  const now = Date.now()
  // 到点项比现在早一分钟以上，说明是关掉应用后补上的；只补这一次。
  const late = !manual && Number.isFinite(at) && at < now - 60_000
  const nextAt = nextPromiseRunAt(promise.schedule, now)

  if (room.state === ROOM_STATE.paused || room.state === ROOM_STATE.stopped || isBusy(room)) {
    if (manual) {
      notice(store, room.id, '房间还在忙，这一期没有开始；等这一轮跑完再手动跑。')
      return true
    }
    const updated = updatePromise({
      store,
      roomId: room.id,
      promise,
      patch: { nextAt, lastRunAt: now, lastRunStatus: 'skipped' },
      type: 'promise.skipped',
      payload: { at: event.payload?.at },
    })
    if (updated !== null) {
      armPromise({ store, roomId: room.id, promise: updated.promise })
      notice(store, room.id, '这一期房间还在忙，跳过了；下次到点再来。')
      emit('room', updated)
    }
    return true
  }

  // 读和开之间可能被用户暂停或改口；开跑前再认一次，别让已经停掉的事又跑起来。
  const latest = promiseOf(store.readRoom(room.id))
  if (latest === null || latest.status !== PROMISE_STATUS.active || latest.version !== promise.version) return true

  let result
  try {
    result = await startRound({
      store,
      live,
      emit,
      room,
      body: { goal: promise.text },
      roomFiles,
      startMessage: { kind: 'chat', authorId: 'you', text: promise.text },
    })
  } catch (error) {
    result = { ok: false, error: String(error?.message ?? error) }
  }

  if (result?.ok !== true) {
    const updated = updatePromise({
      store,
      roomId: room.id,
      promise,
      patch: {
        nextAt,
        lastRunAt: now,
        lastRunStatus: 'failed',
        lastError: String(result?.error ?? '这一期没有开起来').slice(0, 300),
      },
      type: 'promise.failed',
      payload: { at: event.payload?.at, manual },
    })
    if (updated !== null) {
      armPromise({ store, roomId: room.id, promise: updated.promise })
      notice(store, room.id, `这一期没开起来：${result?.error ?? '先看看房间状态'}`)
      emit('room', updated)
    }
    return true
  }

  const roundId = result.body?.round?.id ?? null
  const updated = updatePromise({
    store,
    roomId: room.id,
    promise,
    patch: {
      nextAt,
      lastRunAt: now,
      lastRoundId: roundId,
      lastRunStatus: 'started',
      runs: (promise.runs ?? 0) + 1,
    },
    type: 'promise.run',
    payload: { at: event.payload?.at, manual, roundId },
  })
  if (updated !== null) {
    armPromise({ store, roomId: room.id, promise: updated.promise })
    if (late) notice(store, room.id, '这一期是补上的：打开应用后补了一次。')
    emit('room', updated)
  }
  return true
}
