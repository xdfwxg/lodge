export const ROUTINE_TRIGGER = Object.freeze({
  ON_OPEN: 'on-open',
})

export const ROUTINE_TRIGGER_LABELS = Object.freeze({
  [ROUTINE_TRIGGER.ON_OPEN]: '每次打开 Lodge 再跑一次',
})

export const parseRoutineTrigger = value => (
  value === ROUTINE_TRIGGER.ON_OPEN ? ROUTINE_TRIGGER.ON_OPEN : null
)

export const routineOf = room => {
  const routine = room?.routine
  if (routine === null || routine === undefined || typeof routine !== 'object') return null
  const trigger = parseRoutineTrigger(routine.trigger)
  if (trigger === null) return null
  return {
    trigger,
    enabled: routine.enabled === true,
    updatedAt: Number.isFinite(routine.updatedAt) ? routine.updatedAt : null,
    lastRunAt: Number.isFinite(routine.lastRunAt) ? routine.lastRunAt : null,
    lastRoomId: typeof routine.lastRoomId === 'string' ? routine.lastRoomId : null,
  }
}

export const routineLabelOf = room => ROUTINE_TRIGGER_LABELS[routineOf(room)?.trigger] ?? ''
