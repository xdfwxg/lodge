

const MD = { code: { copyLabel: '复制', copiedLabel: '已复制' } }
const pad = value => String(value).padStart(2, '0')

// 行内时钟：同一天的聊天里只显示 HH:mm；正式时间用 dateTimeOf。
const timeOf = ts => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const dateTimeOf = ts => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${timeOf(ts)}`
}

const durationOf = value => {
  const total = Math.max(0, Math.floor((Number(value) || 0) / 1000))
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes < 60) return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}
export { MD, timeOf, dateTimeOf, durationOf }
