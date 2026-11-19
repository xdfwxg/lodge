export const ROUTINE_DAYS = Object.freeze([1, 2, 3, 4, 5, 6, 0])
export const ALL_DAYS = Object.freeze([0, 1, 2, 3, 4, 5, 6])

export const DAY_LABELS = Object.freeze({
  0: '周日',
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
})

const MIN_GAP_MS = 15 * 60 * 1000
const WEEKDAYS = '日一二三四五六'

const timeOrNull = value => (Number.isFinite(value) ? value : null)

export const normalizeDays = value => {
  const list = Array.isArray(value) ? value : ALL_DAYS
  return [...new Set(list
    .map(Number)
    .filter(day => Number.isInteger(day) && day >= 0 && day <= 6))]
    .sort((a, b) => a - b)
}

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
  if (!Array.isArray(routine.days)) return null
  const days = normalizeDays(routine.days)
  if (days.length === 0) return null
  return {
    days,
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

export const scheduleOf = routine => {
  const days = normalizeDays(routine?.days)
  return {
    days: days.length === 0 ? [...ALL_DAYS] : days,
    hour: parseHour(routine?.hour),
    minute: parseMinute(routine?.minute),
  }
}

const orderedDays = days => ROUTINE_DAYS.filter(day => days.includes(day))
const sameDays = (a, b) => a.length === b.length && a.every((day, index) => day === b[index])

export const daysLabelOf = value => {
  const days = normalizeDays(value)
  if (days.length === 7) return '每天'
  if (days.length === 6) {
    const missing = ALL_DAYS.find(day => !days.includes(day))
    return `除${DAY_LABELS[missing]}外每天`
  }
  const ordered = orderedDays(days)
  if (sameDays(ordered, [1, 2, 3, 4, 5])) return '周一到周五'
  if (sameDays(ordered, [6, 0])) return '周六、周日'
  return ordered.map(day => DAY_LABELS[day]).join('、')
}

export const scheduleLabelOf = routine => {
  const schedule = scheduleOf(routine)
  return `${daysLabelOf(schedule.days)} ${clockOf(schedule.hour, schedule.minute)}`
}

const slotAt = (date, hour, minute) => {
  const slot = new Date(date)
  slot.setHours(hour, minute, 0, 0)
  return slot
}

export const nextRoutineSlotAt = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  const cursor = new Date(now)
  for (let index = 0; index < 8; index += 1) {
    const slot = slotAt(cursor, schedule.hour, schedule.minute)
    if (slot.getTime() > now && schedule.days.includes(slot.getDay())) return slot.getTime()
    cursor.setDate(cursor.getDate() + 1)
  }
  return null
}

export const nextRoutineAt = (routine, now = Date.now()) => (
  nextRoutineSlotAt(routine, now + MIN_GAP_MS - 1)
)

// 刚设成例行工作时：今天这一班已经错过，就现在补一次；还没到点就等下一班。
export const catchUpRoutineAt = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  const slot = slotAt(now, schedule.hour, schedule.minute)
  if (schedule.days.includes(slot.getDay()) && slot.getTime() <= now) return now
  return nextRoutineSlotAt(schedule, now)
}

// 迟到的那次只在今天这一班已经到点后才补；今天不排班就等下一次。
export const routineDueNow = (routine, now = Date.now()) => {
  const schedule = scheduleOf(routine)
  const slot = slotAt(now, schedule.hour, schedule.minute)
  return schedule.days.includes(slot.getDay()) && slot.getTime() <= now
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
