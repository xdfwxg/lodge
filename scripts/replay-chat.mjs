import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { replayChat } from '../server/crew/rounds/replay-chat.js'

const option = name => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const dataDir = resolve(option('--data-dir') ?? process.env.CREW_DATA_DIR ?? '.data')
const roomId = option('--room')
const requestedRound = option('--round')
const database = join(dataDir, 'crew.db')
if (roomId === undefined || roomId === '') {
  console.error('用法：npm run replay:chat -- --room <房间 id> [--round <轮次>] [--data-dir .data]')
  process.exit(2)
}
if (!existsSync(database)) {
  console.error(`没有数据库：${database}`)
  process.exit(2)
}

const db = new DatabaseSync(database, { readOnly: true })
const parse = value => JSON.parse(value)
const clock = at => (
  Number.isFinite(at) ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) : '--:--:--'
)

const roomRow = db.prepare('SELECT payload FROM room WHERE id = ?').get(roomId)
if (roomRow === undefined) {
  console.error(`没有这间房：${roomId}`)
  process.exit(2)
}
const room = parse(roomRow.payload)
const events = db.prepare('SELECT seq, type, payload, at FROM room_event WHERE room_id = ? ORDER BY seq ASC')
  .all(roomId)
  .map(row => ({ seq: row.seq, type: row.type, payload: parse(row.payload), at: row.at }))
const messages = db.prepare('SELECT seq, payload FROM messages WHERE room_id = ? ORDER BY seq ASC')
  .all(roomId)
  .map(row => ({ ...parse(row.payload), seq: row.seq }))
const replay = replayChat({ events, messages, members: room.members ?? [] })

const wanted = requestedRound === undefined ? null : Number(requestedRound)
const rounds = wanted === null ? replay.rounds : replay.rounds.filter(entry => entry.round === wanted)

console.log(`room ${roomId} · ${room.goal ?? room.name ?? ''}`.trim())
if (rounds.length === 0) console.log('(没有匹配的聊天轮次)')
for (const entry of rounds) {
  const marks = [
    `${entry.speakers.length} 次叫名`,
    entry.conclusion === null ? '还没有结论' : '已有结论',
    ...(entry.continued ? [`接着第 ${entry.continuedFrom} 轮`] : []),
    ...(entry.resumes > 0 ? [`续跑 ${entry.resumes} 次`] : []),
    ...(entry.restarted ? ['中途重开过'] : []),
  ]
  console.log('')
  console.log(`round ${entry.round} · ${marks.join(' · ')}`)
  if (entry.note !== '') console.log(`  备注：${entry.note}`)
  for (const item of entry.messages) {
    console.log(`  ${clock(item.at)} ${item.name}（${item.kind === 'chat_rework' ? '再讨论' : '发言'}）`)
    for (const line of item.text.split('\n')) console.log(`    ${line}`)
  }
  if (entry.conclusion !== null) {
    console.log(`  结论${entry.conclusion.fallback ? '（自动摘要：主持没有回应）' : ''}：${clock(entry.conclusion.at)}`)
    for (const line of entry.conclusion.text.split('\n')) console.log(`    ${line}`)
    const todos = entry.conclusion.handoff?.todos
    if (Array.isArray(todos) && todos.length > 0) console.log(`    待办：${todos.join('；')}`)
  }
  for (const warning of entry.warnings) console.log(`  警告：${warning}`)
}
for (const warning of replay.warnings) console.log(`警告：${warning}`)
