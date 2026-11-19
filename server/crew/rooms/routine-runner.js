import {
  nextRoutineAt,
  nextRoutineSlotAt,
  routineDueNow,
  routineNextLabel,
  routineOf,
  routineRunNameOf,
  routineTimerId,
} from '../../../shared/routine.js'

// 一个例行工作对外始终是一间房；每次到点在里面开一次新的执行，旧的进往次。
export const createRoutineRunner = ({ store, service, emit = () => {}, now = Date.now }) => {
  const armTimer = (roomId, dueAt) => {
    store.setTimer?.({
      id: routineTimerId(roomId),
      roomId,
      kind: 'routine',
      payload: { sourceRoomId: roomId },
      dueAt,
    })
  }

  return async sourceRoomId => {
    const source = store.readRoom(sourceRoomId)
    const routine = routineOf(source)
    if (source === null || routine?.enabled !== true) return
    const schedule = { cadence: routine.cadence, hour: routine.hour, minute: routine.minute }
    const at = now()
    if (!routineDueNow(routine, at)) {
      const nextRunAt = nextRoutineSlotAt(schedule, at)
      const deferred = store.updateRoom(source.id, current => {
        current.routine = { ...(current.routine ?? {}), nextRunAt }
        return { events: [] }
      })
      if (deferred !== null) {
        armTimer(source.id, nextRunAt)
        emit('room', store.readRoom(source.id) ?? deferred)
      }
      return
    }
    const nextRunAt = nextRoutineAt(schedule, at)
    const previous = routine.lastRoomId === null ? null : store.readRoom(routine.lastRoomId)
    const unfinished = previous !== null && (previous.state === 'active' || previous.state === 'paused')
    if (unfinished) {
      const skipped = store.updateRoom(source.id, current => {
        current.routine = { ...(current.routine ?? {}), skippedAt: at, nextRunAt }
        return { events: [{ type: 'room.routine.skipped', payload: { roomId: previous.id } }] }
      })
      if (skipped !== null) {
        armTimer(source.id, nextRunAt)
        emit('room', store.readRoom(source.id) ?? skipped)
      }
      return
    }
    const repoPath = typeof source.sourceRepo === 'string' && source.sourceRepo !== ''
      ? source.sourceRepo
      : source.repoPath
    let createdRoomId = null
    let failure = null
    try {
      const result = await service.createRoom({
        goal: source.goal,
        name: routineRunNameOf(source, at),
        roomType: 'studio',
        verify: source.verify ?? 'manual',
        acceptance: source.acceptance ?? '',
        ...(typeof repoPath === 'string' && repoPath !== '' ? { repoPath } : {}),
      })
      if (result?.ok !== true) {
        failure = result?.error ?? '没能开始'
      } else {
        createdRoomId = result.body?.room?.id ?? result.room?.id ?? null
      }
    } catch (error) {
      failure = error?.message ?? String(error)
    }
    if (createdRoomId !== null) {
      const runRoom = store.updateRoom(createdRoomId, current => {
        current.routineGoalId = source.id
        current.routineRun = true
        return { events: [] }
      })
      if (runRoom !== null) emit('room', store.readRoom(runRoom.id) ?? runRoom)
    }
    const success = createdRoomId !== null
    const nextFailures = success ? 0 : routine.failures + 1
    const paused = !success && nextFailures >= 3
    const runIds = success
      ? [...routine.runIds, createdRoomId].filter(id => typeof id === 'string').slice(-20)
      : routine.runIds
    const updated = store.updateRoom(source.id, current => {
      current.routine = {
        ...(current.routine ?? {}),
        ...(success
          ? {
              lastRunAt: at,
              lastRoomId: createdRoomId,
              runIds,
              nextRunAt,
              failures: 0,
              paused: false,
              lastError: null,
              skippedAt: null,
              unseenResult: false,
            }
          : {
              failures: nextFailures,
              lastError: failure,
              enabled: !paused,
              paused,
              nextRunAt: paused ? null : nextRunAt,
            }),
      }
      return {
        events: [{
          type: success ? 'room.routine.ran' : 'room.routine.failed',
          payload: { roomId: createdRoomId, failures: nextFailures, paused },
        }],
      }
    })
    if (updated === null) return
    if (success) {
      const dropped = routine.runIds.slice(0, Math.max(0, routine.runIds.length + 1 - 20))
      for (const id of dropped) {
        const runRoom = store.readRoom(id)
        if (runRoom !== null && runRoom.archivedAt === undefined) {
          store.updateRoom(id, current => {
            current.archivedAt = now()
            return { events: [] }
          })
        }
      }
    }
    if (paused) {
      store.cancelTimer?.(routineTimerId(source.id))
      store.appendMessage(source.id, { kind: 'system', text: '连续 3 次没做成，已经停下。' })
    } else {
      armTimer(source.id, nextRunAt)
      if (!success) {
        store.appendMessage(source.id, {
          kind: 'system',
          text: `这次没开始：${failure}。下次 ${routineNextLabel(nextRunAt, at)} 再试。`,
        })
      }
    }
    emit('room', store.readRoom(source.id) ?? updated)
  }
}
