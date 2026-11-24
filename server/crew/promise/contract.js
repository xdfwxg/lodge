import {
  PROMISE_STATUS,
  nextPromiseRunAt,
  normalizePromiseDelivery,
  normalizePromiseSchedule,
} from '../../../shared/promise.js'

// 房间说好的一件事只认这几个字段；存储里多出来的字段不参与判断。
export const promiseOf = room => {
  const promise = room?.promise
  if (promise === null || promise === undefined || typeof promise !== 'object') return null
  if (typeof promise.text !== 'string' || promise.text.trim() === '') return null
  return {
    ...promise,
    schedule: normalizePromiseSchedule(promise.schedule),
    delivery: normalizePromiseDelivery(promise.delivery),
  }
}

export const newPromise = ({ text, schedule, delivery, now = Date.now() }) => {
  const normalized = normalizePromiseSchedule(schedule)
  return {
    text: String(text ?? '').trim().slice(0, 2000),
    schedule: normalized,
    delivery: normalizePromiseDelivery(delivery),
    status: PROMISE_STATUS.active,
    createdAt: now,
    updatedAt: now,
    nextAt: nextPromiseRunAt(normalized, now),
    runs: 0,
    lastRunAt: null,
    lastRoundId: null,
    lastRunStatus: null,
    version: 1,
  }
}

// 每次改口都会换一代；停掉再继续能重新排上，不会被旧的取消项挡住。
export const promiseTickId = (roomId, at, version = 0) => `promise.tick:${roomId}:${at}:${version}`
