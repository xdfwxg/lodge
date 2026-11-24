import { accepted, created, fail } from '../result.js'
import { ROOM_STATE } from '../../../shared/states.js'
import {
  PROMISE_STATUS,
  nextPromiseRunAt,
  normalizePromiseDelivery,
  normalizePromiseSchedule,
  promiseDeliveryError,
  promiseScheduleError,
} from '../../../shared/promise.js'
import { newPromise, promiseOf, promiseTickId } from './contract.js'
import { armPromise, disarmPromise } from './queue.js'

const canHoldPromise = room => (
  room?.roomType === 'studio' &&
  room.live === true &&
  room.demo !== true &&
  (room.archivedAt === undefined || room.archivedAt === null)
)

const textOf = (body, fallback = '') => (
  typeof body?.text === 'string' ? body.text.trim() : String(fallback ?? '').trim()
)

// 三个动作只做“说好/改口/现在做”，真正开一轮在 runtime 里。
// 状态变化由房间顶部那一行体现，不再往时间线塞系统消息。
export const createPromiseActions = ({ store, emit, emailReady = () => true }) => ({
  promise: async ({ room, readBody }) => {
    if (!canHoldPromise(room)) return fail('invalid', '这间房还不能接常驻的事；先在工作间里做一次')
    if (room.state === ROOM_STATE.paused || room.state === ROOM_STATE.stopped) {
      return fail('conflict', '先让房间继续，再说好这件事')
    }
    const current = promiseOf(room)
    if (current !== null && current.status !== PROMISE_STATUS.stopped) {
      return fail('conflict', '这间房已经说好了一件事；先改它或停掉')
    }
    const body = await readBody()
    const scheduleProblem = promiseScheduleError(body.schedule)
    if (scheduleProblem !== '') return fail('invalid', scheduleProblem)
    const deliveryProblem = promiseDeliveryError(body.delivery)
    if (deliveryProblem !== '') return fail('invalid', deliveryProblem)
    if (body.delivery?.channel === 'email' && emailReady() !== true) {
      return fail('unavailable', '邮箱还没接上；先配置 LODGE_SMTP_URL 和 LODGE_EMAIL_FROM')
    }
    const text = textOf(body, room.goal)
    if (text === '') return fail('invalid', '说一句每周要做什么')
    if (text.length > 2000) return fail('invalid', '一句话最多 2000 字')
    const promise = newPromise({ text, schedule: body.schedule, delivery: body.delivery })
    const updated = store.updateRoom(room.id, roomNow => {
      const existing = promiseOf(roomNow)
      if (existing !== null && existing.status !== PROMISE_STATUS.stopped) return null
      roomNow.promise = promise
      return { events: [{ type: 'promise.created', payload: { text, at: promise.nextAt } }] }
    })
    if (updated === null) return fail('conflict', '这间房刚刚也有人说了这件事；刷新后再试')
    armPromise({ store, roomId: room.id, promise: updated.promise })
    emit('room', updated)
    return created({ room: updated })
  },

  'promise-update': async ({ room, readBody }) => {
    if (room.archivedAt !== undefined && room.archivedAt !== null) return fail('conflict', '房间归档了；先恢复')
    const promise = promiseOf(room)
    if (promise === null) return fail('conflict', '这间房还没有说好的事')
    const body = await readBody()
    const status = body.status ?? promise.status
    if (!Object.values(PROMISE_STATUS).includes(status)) return fail('invalid', '状态不对')
    const scheduleProblem = promiseScheduleError(body.schedule)
    if (scheduleProblem !== '') return fail('invalid', scheduleProblem)
    const deliveryProblem = promiseDeliveryError(body.delivery)
    if (deliveryProblem !== '') return fail('invalid', deliveryProblem)
    if (body.delivery?.channel === 'email' && emailReady() !== true) {
      return fail('unavailable', '邮箱还没接上；先配置 LODGE_SMTP_URL 和 LODGE_EMAIL_FROM')
    }
    const schedule = body.schedule === undefined ? promise.schedule : normalizePromiseSchedule(body.schedule)
    const delivery = body.delivery === undefined ? promise.delivery : body.delivery
    const text = textOf(body, promise.text)
    if (text === '') return fail('invalid', '说一句要做什么')
    if (text.length > 2000) return fail('invalid', '一句话最多 2000 字')

    disarmPromise({ store, roomId: room.id, promise })
    const now = Date.now()
    const nextAt = status === PROMISE_STATUS.active ? nextPromiseRunAt(schedule, now) : promise.nextAt
    const nextPromise = {
      ...promise,
      text,
      schedule,
      delivery: normalizePromiseDelivery(delivery),
      status,
      nextAt,
      updatedAt: now,
      version: promise.version + 1,
    }
    const updated = store.updateRoom(room.id, current => {
      if (current.promise?.version !== promise.version) return null
      current.promise = nextPromise
      return { events: [{ type: 'promise.updated', payload: { status, at: nextAt } }] }
    })
    if (updated === null) {
      // 这次改口没写进去，旧的到点项不能留在取消态；把它接回去。
      armPromise({ store, roomId: room.id, promise })
      return fail('conflict', '这件事刚刚改过；刷新后再试')
    }

    if (status === PROMISE_STATUS.active) {
      armPromise({ store, roomId: room.id, promise: nextPromise })
    }
    emit('room', updated)
    return accepted({ room: updated })
  },

  'promise-run': async ({ room }) => {
    if (room.archivedAt !== undefined && room.archivedAt !== null) return fail('conflict', '房间归档了；先恢复')
    const promise = promiseOf(room)
    if (promise === null) return fail('conflict', '这间房还没有说好的事')
    if (promise.status !== PROMISE_STATUS.active) return fail('conflict', '先继续这件事，再手动跑')
    if (room.state === ROOM_STATE.paused || room.state === ROOM_STATE.stopped) {
      return fail('conflict', '房间现在是停的，先继续')
    }
    if (typeof room.activeRoundId === 'string' && room.activeRoundId !== '') {
      return fail('conflict', '这一轮还没结束，等它跑完再手动跑')
    }
    const now = Date.now()
    const queued = store.enqueueWork?.({
      id: promiseTickId(room.id, `manual:${now}`),
      roomId: room.id,
      kind: 'promise.tick',
      payload: { manual: true },
      availableAt: 0,
      maxAttempts: 1,
    })
    if (queued === null) return fail('conflict', '这一期已经在排队')
    return accepted({ accepted: true })
  },
})
