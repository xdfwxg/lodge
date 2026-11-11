import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
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

export const parseUsageRange = value => {
  const match = /^(\d{1,2})([dh])$/.exec(String(value ?? '7d'))
  const amount = match === null ? 7 : Math.max(1, Math.min(90, Number(match[1])))
  const days = match?.[2] === 'h' ? 1 : amount
  return { id: match === null ? '7d' : `${amount}${match[2]}`, days }
}

const dayKey = at => new Date(at).toISOString().slice(0, 10)
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
  const dayMs = 24 * 60 * 60 * 1000
  const today = Date.parse(`${dayKey(now)}T00:00:00.000Z`)
  const start = today - (parsed.days - 1) * dayMs
  const buckets = Array.from({ length: parsed.days }, (_, index) => ({
    day: dayKey(start + index * dayMs),
    ...emptyTotals(),
  }))
  const byDay = new Map(buckets.map(bucket => [bucket.day, bucket]))
  const totals = emptyTotals()
  const roomTotals = []

  for (const room of rooms) {
    if (room.imported === true) continue
    const history = historyOf(room).filter(entry => entry.at >= start)
    const entries = history.length > 0
      ? history
      : room.usage === undefined ? [] : [{ at: now, ...room.usage }]
    const roomTotal = { roomId: room.id, name: room.name, ...emptyTotals() }
    for (const entry of entries) {
      const bucket = byDay.get(dayKey(entry.at))
      if (bucket === undefined) continue
      add(bucket, entry)
      add(totals, entry)
      add(roomTotal, entry)
    }
    roomTotals.push(roomTotal)
  }

  return {
    range: parsed.id,
    days: parsed.days,
    buckets,
    rooms: roomTotals.sort((a, b) => b.costMicroUsd - a.costMicroUsd),
    totals,
  }
}
