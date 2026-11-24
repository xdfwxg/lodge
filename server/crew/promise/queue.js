import { PROMISE_STATUS } from '../../../shared/promise.js'
import { promiseTickId } from './contract.js'

// 一件说好的事只占一个到点项；同一次到点用同一个 id，重启也不会多跑。
// id 带 version；改口后是新的一项。这里不用 dedupeKey：旧项可能已取消，需要能被重新排上。
export const armPromise = ({ store, roomId, promise }) => {
  if (promise?.status !== PROMISE_STATUS.active) return null
  if (!Number.isFinite(promise?.nextAt)) return null
  const id = promiseTickId(roomId, promise.nextAt, promise.version ?? 0)
  return store.enqueueWork?.({
    id,
    roomId,
    kind: 'promise.tick',
    payload: { at: promise.nextAt },
    availableAt: promise.nextAt,
    maxAttempts: 2,
  }) ?? null
}

export const disarmPromise = ({ store, roomId, promise }) => {
  if (!Number.isFinite(promise?.nextAt)) return
  store.cancelWork?.(promiseTickId(roomId, promise.nextAt, promise.version ?? 0))
}
