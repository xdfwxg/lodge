// 持久 timer → 每房 inbox → 单 worker。审批超时走这条路，进程重启后不会丢。
export const createRoomScheduler = ({ store, live, intervalMs = 1000, now = Date.now }) => {
  let timer = null
  let busy = false
  let started = false

  // 调度器只负责到点和租约；具体做什么由房型的工作处理器决定。
  const handle = async event => {
    const handled = await live.handleWork?.(event)
    if (handled !== true) throw new Error(`没有房型处理这个后台动作：${event.kind}`)
  }

  const tick = async () => {
    if (busy) return
    busy = true
    try {
      const reclaimed = store.reclaimWork?.({ now: now() })
      for (const item of reclaimed?.dead ?? []) {
        try {
          store.appendMessage?.(item.room_id, {
            kind: 'system',
            text: '有一个后台动作重试多次没成功；待处理。',
          })
        } catch {}
      }
      for (const room of store.readRooms()) {
        const event = store.claimWork(room.id, { now: now() })
        if (event === null) continue
        try {
          await handle(event)
          store.completeWork(event.id)
        } catch (error) {
          const failed = store.failWork(event.id, error?.message ?? error)
          if (failed?.dead === true) {
            try {
              store.appendMessage?.(event.roomId, {
                kind: 'system',
                text: '有一个后台动作重试多次没成功；待处理。',
              })
            } catch {}
          }
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
