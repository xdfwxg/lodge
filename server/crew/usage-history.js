import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { globalBudgetMicroUsd } from './budget.js'
import { roomDir } from './paths.js'

// 用量账本：只追加 runtime 上报的估算值，不改写房间结算。
const usageFile = room => join(roomDir(room), 'usage.jsonl')
const sameUsage = (a, b) => (
  (a?.costMicroUsd ?? 0) === (b?.costMicroUsd ?? 0) &&
  (a?.turns ?? 0) === (b?.turns ?? 0) &&
  (a?.tokens?.input ?? 0) === (b?.tokens?.input ?? 0) &&
  (a?.tokens?.output ?? 0) === (b?.tokens?.output ?? 0)
)

export const recordUsage = (room, previous, source = 'sync') => {
  if (room?.demo === true || room?.imported === true) return null
  if (sameUsage(previous, room?.usage)) return null
  const entry = {
    at: Date.now(),
    roomId: room.id,
    source,
    costMicroUsd: room.usage?.costMicroUsd ?? 0,
    turns: room.usage?.turns ?? 0,
    tokens: room.usage?.tokens ?? null,
  }
  const dir = roomDir(room)
  mkdirSync(dir, { recursive: true })
  const fd = openSync(usageFile(room), 'a')
  try {
    writeSync(fd, `${JSON.stringify(entry)}\n`)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  return entry
}

export const readUsageHistory = room => {
  const file = usageFile(room)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(line => line.trim() !== '')
    .flatMap(line => {
      try {
        const entry = JSON.parse(line)
        return typeof entry?.at === 'number' ? [entry] : []
      } catch {
        return []
      }
    })
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

export const parseUsageRange = value => {
  const raw = String(value ?? '7d')
  const match = /^(\d{1,2})([hdwm])$/.exec(raw)
  const preset = match === null ? { id: '7d', unit: 'day', count: 7 } : { id: raw, unit: { h: 'hour', d: 'day', w: 'week', m: 'month' }[match[2]], count: Number(match[1]) }
  const count = Math.max(1, Math.min(preset.unit === 'hour' ? 48 : preset.unit === 'day' ? 90 : 24, preset.count))
  return { id: preset.id, unit: preset.unit, count }
}

const pad = value => String(value).padStart(2, '0')
const dayLabel = at => `${pad(new Date(at).getUTCMonth() + 1)}-${pad(new Date(at).getUTCDate())}`
const hourLabel = at => `${pad(new Date(at).getUTCHours())}:00`

const bucketStarts = ({ unit, count }, now) => {
  const current = new Date(now)
  if (unit === 'hour') {
    const end = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate(), current.getUTCHours())
    return Array.from({ length: count }, (_, index) => end - (count - 1 - index) * HOUR_MS)
  }
  if (unit === 'day') {
    const end = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate())
    return Array.from({ length: count }, (_, index) => end - (count - 1 - index) * DAY_MS)
  }
  if (unit === 'week') {
    const monday = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()) - ((current.getUTCDay() + 6) % 7) * DAY_MS
    return Array.from({ length: count }, (_, index) => monday - (count - 1 - index) * 7 * DAY_MS)
  }
  const monthStart = Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(monthStart)
    date.setUTCMonth(date.getUTCMonth() - (count - 1 - index))
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
  })
}

const bucketEnd = (start, unit) => {
  if (unit === 'hour') return start + HOUR_MS
  if (unit === 'day') return start + DAY_MS
  if (unit === 'week') return start + 7 * DAY_MS
  const date = new Date(start)
  date.setUTCMonth(date.getUTCMonth() + 1)
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)
}

const emptyTotals = () => ({ costMicroUsd: 0, turns: 0, tokens: { input: 0, output: 0, cachedInput: 0 } })
const add = (total, entry) => {
  total.costMicroUsd += entry.costMicroUsd ?? 0
  total.turns += entry.turns ?? 0
  total.tokens.input += entry.tokens?.input ?? 0
  total.tokens.output += entry.tokens?.output ?? 0
  total.tokens.cachedInput += entry.tokens?.cachedInput ?? 0
}

export const aggregateUsage = ({ rooms, historyOf, range = '7d', now = Date.now() }) => {
  const parsed = parseUsageRange(range)
  const starts = bucketStarts(parsed, now)
  const buckets = starts.map(start => ({
    key: start,
    label: parsed.unit === 'hour' ? hourLabel(start)
      : parsed.unit === 'month' ? `${new Date(start).getUTCFullYear()}-${pad(new Date(start).getUTCMonth() + 1)}`
        : dayLabel(start),
    start,
    end: bucketEnd(start, parsed.unit),
    ...emptyTotals(),
  }))
  const totals = emptyTotals()
  const roomTotals = []

  for (const room of rooms) {
    if (room.imported === true) continue
    const history = historyOf(room)
    const entries = history.length > 0
      ? history
      : room.usage === undefined ? [] : [{ at: now, ...room.usage }]
    const roomTotal = { roomId: room.id, name: room.name, ...emptyTotals() }
    for (const entry of entries) {
      const bucket = buckets.find(item => entry.at >= item.start && entry.at < item.end)
      if (bucket === undefined) continue
      add(bucket, entry)
      add(totals, entry)
      add(roomTotal, entry)
    }
    roomTotals.push(roomTotal)
  }

  return {
    range: parsed.id,
    unit: parsed.unit,
    days: parsed.unit === 'day' ? parsed.count : parsed.unit === 'week' ? parsed.count * 7 : parsed.unit === 'month' ? parsed.count * 30 : 1,
    budgetMicroUsd: globalBudgetMicroUsd(),
    buckets,
    rooms: roomTotals.sort((a, b) => b.costMicroUsd - a.costMicroUsd),
    totals,
  }
}
