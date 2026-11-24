// 房间说好的一件事：什么时候、多久一次、下次是哪天。
// 纯函数只算时间，不碰存储、不碰基座；服务端和界面读同一份结论。
export const PROMISE_STATUS = Object.freeze({
  active: 'active',
  paused: 'paused',
  stopped: 'stopped',
})

export const DEFAULT_PROMISE_SCHEDULE = Object.freeze({ every: 'week', weekday: 5, at: '18:00' })

const WEEKDAY_NAMES = Object.freeze(['周日', '周一', '周二', '周三', '周四', '周五', '周六'])
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/

export const promiseScheduleError = input => {
  if (input === null || input === undefined) return ''
  if (typeof input !== 'object' || Array.isArray(input)) return '重复方式不对'
  if (input.every !== undefined && input.every !== 'day' && input.every !== 'week') return '只能每天或每周'
  if (input.at !== undefined && (typeof input.at !== 'string' || !TIME.test(input.at))) return '时间要写成 HH:MM'
  if (input.every === 'week' && input.weekday !== undefined && (
    !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6
  )) return '星期不对'
  return ''
}

export const normalizePromiseSchedule = input => {
  const every = input?.every === 'day' ? 'day' : 'week'
  const at = typeof input?.at === 'string' && TIME.test(input.at) ? input.at : DEFAULT_PROMISE_SCHEDULE.at
  if (every === 'day') return { every, at }
  const weekday = Number.isInteger(input?.weekday) && input.weekday >= 0 && input.weekday <= 6
    ? input.weekday
    : DEFAULT_PROMISE_SCHEDULE.weekday
  return { every, weekday, at }
}

// 按本机时区算下一次；跨月、跨年、夏令时都交给 Date。
export const nextPromiseRunAt = (schedule, from = Date.now()) => {
  const { every, weekday, at } = normalizePromiseSchedule(schedule)
  const [hour, minute] = at.split(':').map(Number)
  const base = new Date(from)
  const next = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0)
  if (every === 'day') {
    if (next.getTime() <= from) next.setDate(next.getDate() + 1)
    return next.getTime()
  }
  const ahead = (weekday - next.getDay() + 7) % 7
  next.setDate(next.getDate() + ahead)
  if (next.getTime() <= from) next.setDate(next.getDate() + 7)
  return next.getTime()
}

export const promiseScheduleText = schedule => {
  const { every, weekday, at } = normalizePromiseSchedule(schedule)
  return every === 'day' ? `每天 ${at}` : `每${WEEKDAY_NAMES[weekday]} ${at}`
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const promiseDeliveryError = input => {
  if (input === null || input === undefined) return ''
  if (input.channel !== 'room' && input.channel !== 'email') return '发送方式不对'
  if (input.mode !== undefined && input.mode !== 'always' && input.mode !== 'changes') return '发送频率不对'
  if (input.channel === 'email') {
    const to = String(input.to ?? '').trim()
    if (to === '' || !EMAIL.test(to)) return '邮箱地址不对'
    if (to.length > 200) return '邮箱地址太长'
  }
  return ''
}

export const normalizePromiseDelivery = input => {
  const channel = input?.channel === 'email' ? 'email' : 'room'
  return {
    channel,
    to: channel === 'email' ? String(input?.to ?? '').trim().slice(0, 200) : '',
    mode: channel === 'email' && input?.mode === 'changes' ? 'changes' : 'always',
  }
}
