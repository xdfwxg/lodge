import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { diffReplay, replayRound } from '../server/crew/rounds/replay.js'

const option = name => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const dataDir = resolve(option('--data-dir') ?? process.env.CREW_DATA_DIR ?? '.data')
const roomId = option('--room')
const requestedRound = option('--round')
const database = join(dataDir, 'crew.db')
if (roomId === undefined || roomId === '') {
  console.error('用法：npm run replay:round -- --room <房间 id> [--round <轮次 id>] [--data-dir .data]')
  process.exit(2)
}
if (!existsSync(database)) {
  console.error(`没有数据库：${database}`)
  process.exit(2)
}

const db = new DatabaseSync(database, { readOnly: true })
const parse = row => ({ ...row, payload: JSON.parse(row.payload) })

const roundRows = db.prepare('SELECT payload FROM work_round WHERE room_id = ? ORDER BY ordinal DESC LIMIT 50').all(roomId).map(parse)
const activeRoundId = db.prepare('SELECT json_extract(payload, \'$.activeRoundId\') AS id FROM room WHERE id = ?').get(roomId)?.id
const round = requestedRound === undefined
  ? roundRows.find(item => item.payload.id === activeRoundId) ?? roundRows[0]
  : roundRows.find(item => item.payload.id === requestedRound)
const roundId = round?.payload.id ?? requestedRound ?? ''

const events = db.prepare('SELECT seq, type, payload, at FROM room_event WHERE room_id = ? ORDER BY seq ASC').all(roomId).map(parse)
const assignments = db.prepare('SELECT payload FROM assignment WHERE room_id = ?').all(roomId)
  .map(row => JSON.parse(row.payload))
  .filter(item => roundId === '' || item.workRoundId === roundId || item.workRoundId === undefined)

const replay = replayRound(events, roundId)
const diffs = diffReplay(replay, { round: round?.payload ?? null, assignments })

console.log(`room ${roomId} · round ${replay.roundId || '(none)'}`)
console.log(`events ${events.length} · warnings ${replay.warnings.length === 0 ? 'none' : replay.warnings.join('; ')}`)
console.log('stages:')
if (replay.stages.length === 0) console.log('  (没有阶段快照)')
for (const stage of replay.stages) {
  const current = round?.payload?.stages?.[stage.index]?.state ?? '(missing)'
  console.log(`  ${stage.index + 1}. ${stage.title}: event ${stage.state} / current ${current}`)
}
console.log('assignments:')
for (const item of replay.assignments) {
  const current = assignments.find(assignment => assignment.id === item.id)?.status ?? '(missing)'
  console.log(`  ${item.id} stage ${item.stage + 1}: event ${item.status} / current ${current}`)
}
if (diffs.length === 0) {
  console.log('drift: none')
} else {
  console.log(`drift: ${diffs.length}`)
  for (const diff of diffs) console.log(`  ${JSON.stringify(diff)}`)
}
