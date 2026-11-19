// 持久 timer → 每房 inbox → 单 worker。审批超时和例行工作都走同一条路，
// 进程重启后不会丢；例行工作到点时 App 开着就现在跑，关着就等下次打开。
export const createRoomScheduler = ({ store, live, onRoutine = null, intervalMs = 1000, now = Date.now }) => {
  let timer = null
  let busy = false
  let started = false

  const handle = async event => {
    if (event.kind === 'approval') {
      await live.expireApprovals?.(event.roomId, '确认超时')
      return
    }
    if (event.kind === 'routine') {
      await onRoutine?.(event.payload?.sourceRoomId ?? event.roomId)
    }
  }

  const tick = async () => {
    if (busy) return
    busy = true
    try {
      for (const due of store.dueTimers(now())) {
        const claimed = store.completeTimer(due.id)
        if (claimed.changes !== 1) continue
        store.enqueueInbox({
          roomId: due.roomId,
          kind: due.kind,
          payload: due.payload,
          sourceId: `timer:${due.id}:${due.dueAt}`,
        })
      }
      for (const room of store.readRooms()) {
        const event = store.claimInbox(room.id)
        if (event === null) continue
        try {
          await handle(event)
          store.completeInbox(event.id)
        } catch {
          store.failInbox(event.id)
        }
      }
    } finally {
      busy = false
    }
  }

  return {
    tick,
    start: () => {
      if (started) return
      started = true
      timer = setInterval(() => { void tick() }, intervalMs)
      timer.unref?.()
    },
    stop: () => {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
  }
}
