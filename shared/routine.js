export const ROUTINE_CADENCE = Object.freeze({
  DAILY: 'daily',
  WEEKLY: 'weekly',
})

export const CADENCE_LABELS = Object.freeze({
  [ROUTINE_CADENCE.DAILY]: '每天早上',
  [ROUTINE_CADENCE.WEEKLY]: '每周一早上',
})

const MIN_GAP_MS = 15 * 60 * 1000
const WEEKDAYS = '日一二三四五六'

const timeOrNull = value => (Number.isFinite(value) ? value : null)

export const parseCadence = value => (
  value === ROUTINE_CADENCE.WEEKLY ? ROUTINE_CADENCE.WEEKLY : ROUTINE_CADENCE.DAILY
)

export const parseHour = value => {
  const hour = Number(value)
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 8
}

export const parseMinute = value => {
  const minute = Number(value)
  return Number.isInteger(minute) && minute >= 0 && minute <= 59 ? minute : 0
}

export const clockOf = (hour, minute) => `${hour}:${String(minute).padStart(2, '0')}`

export const parseClock = value => {
  if (typeof value !== 'string') return null
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (match === null) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 ? { hour, minute } : null
}

export const routineOf = room => {
  const routine = room?.routine
  if (routine === null || routine === undefined || typeof routine !== 'object') return null
  if (routine.cadence !== ROUTINE_CADENCE.DAILY && routine.cadence !== ROUTINE_CADENCE.WEEKLY) return null
  return {
    cadence: routine.cadence,
    hour: parseHour(routine.hour),
    minute: parseMinute(routine.minute),
    enabled: routine.enabled === true,
    updatedAt: timeOrNull(routine.updatedAt),
    lastRunAt: timeOrNull(routine.lastRunAt),
    lastFinishedAt: timeOrNull(routine.lastFinishedAt),
    nextRunAt: timeOrNull(routine.nextRunAt),
    lastRoomId: typeof routine.lastRoomId === 'string' ? routine.lastRoomId : null,
    runIds: Array.isArray(routine.runIds) ? routine.runIds.filter(id => typeof id === 'string') : [],
    failures: Number.isInteger(routine.failures) && routine.failures >= 0 ? routine.failures : 0,
    paused: routine.paused === true,
    skippedAt: timeOrNull(routine.skippedAt),
    lastError: typeof routine.lastError === 'string' ? routine.lastError : '',
    unseenResult: routine.unseenResult === true,
  }
}

export const scheduleOf = routine => ({
  cadence: parseCadence(routine?.cadence),
  hour: parseHour(routine?.hour),
  minute: parseMinute(routine?.minute),
})

export const scheduleLabelOf = routine => {
  const schedule = scheduleOf(routine)
  return `${CADENCE_LABELS[schedule.cadence]} ${clockOf(schedule.hour, schedule.minute)}`
}

const withGap = (at, now, cadence) => {
  let next = at
  const step = cadence === ROUTINE_CADENCE.WEEKLY ? 7 : 1
  while (next - now < MIN_GAP_MS) {
    const date = new Date(next)
    date.setDate(date.getDate() + step)
    next = date.getTime()
  }
  return next
}

export const nextRoutineSlotAt = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  const next = new Date(now)
  next.setHours(schedule.hour, schedule.minute, 0, 0)
  if (schedule.cadence === ROUTINE_CADENCE.WEEKLY) {
    next.setDate(next.getDate() + ((1 - next.getDay() + 7) % 7))
    if (next.getTime() <= now) next.setDate(next.getDate() + 7)
  } else if (next.getTime() <= now) {
    next.setDate(next.getDate() + 1)
  }
  return next.getTime()
}

export const nextRoutineAt = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  return withGap(nextRoutineSlotAt(routine, now), now, schedule.cadence)
}

// 刚设成例行工作时：今天这一班已经错过，就现在补一次；还没到点就等下一班。
export const catchUpRoutineAt = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  const slot = new Date(now)
  slot.setHours(schedule.hour, schedule.minute, 0, 0)
  if (schedule.cadence === ROUTINE_CADENCE.WEEKLY) {
    slot.setDate(slot.getDate() - ((slot.getDay() - 1 + 7) % 7))
  }
  return slot.getTime() <= now ? now : nextRoutineSlotAt(schedule, now)
}

// 迟到的那次只在今天这一班已经到点后才补；今天还没到点就等今天，
// 避免昨天错过的一次和今天的一次在一小时内连着跑。
export const routineDueNow = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  const slot = new Date(now)
  slot.setHours(schedule.hour, schedule.minute, 0, 0)
  if (schedule.cadence === ROUTINE_CADENCE.WEEKLY && slot.getDay() !== 1) return true
  return slot.getTime() <= now
}

const startOfDay = value => {
  const date = new Date(value)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const momentLabel = (at, now) => {
  const date = new Date(at)
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000)
  const clock = `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
  if (days === 0) return `今天 ${clock}`
  if (days === 1) return date.getHours() < 12 ? `明早 ${clock}` : `明天 ${clock}`
  if (days === -1) return `昨天 ${clock}`
  if (days > 1 && days < 7) return `周${WEEKDAYS[date.getDay()]} ${clock}`
  return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`
}

export const momentLabelOf = (at, now = Date.now()) => (
  Number.isFinite(at) ? momentLabel(at, now) : ''
)

export const routineNextLabel = (nextRunAt, now = Date.now()) => momentLabelOf(nextRunAt, now)

// 房间行只讲两件事：今天的结果怎么样，下一次什么时候。
export const routineLineOf = (room, now = Date.now()) => {
  const routine = routineOf(room)
  if (routine === null) return ''
  if (routine.paused === true) return '已经停下'
  if (routine.enabled !== true) return ''
  if (routine.lastFinishedAt !== null && startOfDay(routine.lastFinishedAt) === startOfDay(now)) {
    return `${momentLabelOf(routine.lastFinishedAt, now)} 做完了`
  }
  return routine.nextRunAt === null ? '' : `下次 ${routineNextLabel(routine.nextRunAt, now)}`
}

export const routineTimerId = roomId => `routine:${roomId}`

export const routineRunNameOf = (room, at = Date.now()) => {
  const date = new Date(at)
  return `${room?.name ?? '这件事'} · ${date.getMonth() + 1}月${date.getDate()}日 ${clockOf(date.getHours(), date.getMinutes())}`
}
