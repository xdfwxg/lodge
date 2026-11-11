import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { buildHandoff } from '../server/crew/handoff.js'
import { sanitizeHandoff } from '../server/crew/sanitize.js'
import { createStore } from '../server/crew/store.js'

const args = process.argv.slice(2)
const valueOf = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const dataDir = valueOf('--data')
const roomId = valueOf('--room')
const out = valueOf('--out')
if (dataDir === undefined || roomId === undefined || out === undefined) {
  console.error('用法：node scripts/export-sample.mjs --data <CREW_DATA_DIR> --room <room-id> --out <file>')
  process.exit(1)
}

const store = createStore({ dataDir: resolve(dataDir) })
const room = store.readRoom(roomId)
if (room === null || room.kind !== 'room') {
  console.error(`没有房间：${roomId}`)
  process.exit(1)
}
const bundle = buildHandoff(room)
if (bundle === null) {
  console.error(`房间没有 transcript.jsonl，不能导出：${roomId}`)
  process.exit(1)
}
const clean = sanitizeHandoff(bundle)
const target = resolve(out)
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, `${JSON.stringify(clean, null, 2)}\n`)
console.log(`sample written: ${target} · ${clean.redactionCount} redactions`)
