import { routineOf } from '../../../shared/routine.js'

// 持久 timer → 每房 inbox → 单 worker。现在先接审批超时和“打开 Lodge 跑一次”；
// 消息、复核和后续定时任务都走同一条路，进程重启后不会丢。
export const createRoomScheduler = ({ store, live, onRoutine = null, intervalMs = 1000, now = Date.now }) => {
  let timer = null
  let busy = false
  let started = false
  const launchId = now()

  const handle = async event => {
    if (event.kind === 'approval') {
      await live.expireApprovals?.(event.roomId, '确认超时')
      return
    }
    if (event.kind === 'routine') {
      await onRoutine?.(event.payload?.sourceRoomId ?? event.roomId)
    }
  }

  const enqueueOpenRoutines = () => {
    for (const room of store.readRooms()) {
      if (routineOf(room)?.enabled !== true) continue
      store.enqueueInbox({
        roomId: room.id,
        kind: 'routine',
        sourceId: `open:${launchId}:${room.id}`,
        payload: { sourceRoomId: room.id },
      })
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
          sourceId: `timer:${due.id}`,
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
      enqueueOpenRoutines()
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
