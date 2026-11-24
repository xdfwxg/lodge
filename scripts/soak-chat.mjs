// 长跑压测：按真实总线路径灌流式增量，观察消息量、堆内存和回合收口。
// 默认 1 分钟；要更久用 npm run soak -- --minutes 30。不进入 check:done。
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createStore } from '../server/crew/store.js'
import { createRoomChat } from '../server/crew/kernel/live/bus.js'
import { normalizeTestRoom } from '../server/crew/testing/room.js'

const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const minutes = Math.max(0.1, Number(option('--minutes', '1')) || 1)
const turnsCap = Math.max(1, Number(option('--turns', '100000')) || 100000)
const deltasPerTurn = Math.max(1, Number(option('--deltas', '200')) || 200)
const deadline = Date.now() + minutes * 60_000
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-soak-'))
const heap = () => Math.round(process.memoryUsage().heapUsed / 1024 / 1024)

const store = createStore({ dataDir })
let handlers = null
const engine = {
  capabilities: () => ({ streaming: true, mentions: true, provisioning: true, approvals: false }),
  subscribe: input => {
    handlers = input
    return () => {}
  },
}

const base = normalizeTestRoom({
  id: 'soak-room',
  name: '长跑房',
  goal: '观察长聊天',
  repoPath: '/tmp/lodge-soak',
  demo: true,
  leadSeat: 'planner',
  seatBots: { planner: 'b-planner', executor: 'b-executor', verifier: 'b-verifier' },
  seatNames: { planner: 'Planner1', executor: 'Executor1', verifier: 'Verifier1' },
  seatSpecs: [
    { id: 'planner', name: '规划师' },
    { id: 'executor', name: '执行者' },
    { id: 'verifier', name: '验收员' },
  ],
})
base.roomType = 'chat'
base.chat = { speaker: 'executor' }
base.chatRoom = { id: 'soak-chat', sessionRef: 'soak-thread' }
store.writeRoom(base)

const chat = createRoomChat({
  store,
  engine,
  projector: { toStored: (roomId, message) => ({ ...message, id: `stored-${message.id}`, roomId }) },
  refresh: async () => {},
  onPermission: () => {},
})
const entry = { roomId: base.id }
chat.subscribe(entry, store.readRoom(base.id))
if (handlers === null) {
  console.error('soak failed: bus did not subscribe')
  process.exit(1)
}

const started = Date.now()
let turns = 0
let firstHeap = heap()
let lastHeap = firstHeap
try {
  while (Date.now() < deadline && turns < turnsCap) {
    const turnId = `turn-${turns}`
    for (let part = 0; part < deltasPerTurn; part += 1) {
      handlers.onEvent({ type: 'delta', delta: `${turns}:${part} `, turnId })
    }
    handlers.onEvent({
      message: {
        id: `final-${turns}`,
        kind: 'text',
        role: 'agent',
        authorRef: 'b-executor',
        text: `第 ${turns} 回合完成`,
        at: Date.now(),
      },
    })
    turns += 1
    if (turns % 50 === 0) {
      lastHeap = heap()
      const count = store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
      console.log(`turns=${turns} messages=${count} heap=${lastHeap}MB elapsed=${Math.round((Date.now() - started) / 1000)}s`)
    }
  }
  const messages = store.db.prepare('SELECT COUNT(*) AS n FROM messages').get().n
  console.log(`soak: ${turns} 回合 · ${messages} 条消息 · ${deltasPerTurn} 增量/回合 · 堆 ${firstHeap}→${lastHeap}MB`)
  if (messages !== turns) {
    console.error(`soak failed: ${turns} 回合留下了 ${messages} 条消息`)
    process.exitCode = 1
  }
} catch (error) {
  console.error(`soak failed: ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  store.db.close()
  rmSync(dataDir, { recursive: true, force: true })
}
