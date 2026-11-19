import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCrewPorts } from './crew/crew-ports.js'
import { createLiveRooms } from './crew/rooms/base/live.js'
import { createRoomScheduler } from './crew/rooms/scheduler.js'
import { createRoutineRunner } from './crew/rooms/routine-runner.js'
import { acquireDataLock } from './crew/lock.js'
import { presentRoom } from './crew/presentation.js'
import { createCrewService } from './crew/service.js'
import { openPath } from './system-open.js'
import { createHttpHandler } from './http.js'
import { collectWorkspaceGarbage } from './crew/workspace-gc.js'
import { ROLES, validateRoster } from './crew/roster.js'
import { assertRuntimePort } from './crew/runtime-port.js'
import { compactAssignments } from './crew/assignment-history.js'
import { createStore } from './crew/store.js'
import { createBaseClient } from './base.js'
import { ensureBrowserMcp } from './browser-mcp.js'
import { clearLodgeBaseResources } from './base-gc.js'
import { createEngine } from './engine.js'
import { chooseDirectory } from './system-dialog.js'
import { recoverMessages } from './crew/recovery.js'
import { pruneBackups, snapshotDatabase, snapshotMemory } from './crew/data-recovery.js'

// 组合根：只做装配与 HTTP 传输，业务全在 server/crew/。
validateRoster(ROLES)
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dataDir = process.env.CREW_DATA_DIR === undefined ? join(root, '.data') : resolve(process.env.CREW_DATA_DIR)
acquireDataLock(dataDir)

const clients = new Set()
const send = (res, event, payload, id) => {
  res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
}
const broadcast = (event, payload, id) => {
  for (const client of clients) send(client, event, payload, id)
}

// schema 迁移前先对旧库做快照；CLI 恢复也用同一份快照格式。
try {
  const file = snapshotDatabase({ dataDir, reason: 'startup', keep: 10 })
  if (file !== null) console.log(`store snapshot: ${file}`)
} catch (error) {
  console.warn(`store snapshot failed: ${error?.message ?? error}`)
}
try {
  const dir = snapshotMemory({ dataDir, reason: 'startup', keep: 10 })
  if (dir !== null) console.log(`memory snapshot: ${dir}`)
} catch (error) {
  console.warn(`memory snapshot failed: ${error?.message ?? error}`)
}

const store = createStore({ dataDir, emit: broadcast })
compactAssignments(store)

// 补齐“transcript 已 fsync、SQLite 还没写”的崩溃窗口；库仍是唯一真相。
try {
  const recovered = recoverMessages(store)
  if (recovered.recovered > 0 || recovered.events > 0) {
    console.log(`recovered ${recovered.recovered} messages and ${recovered.events} events from room logs`)
  }
  if (recovered.roomsWithoutTranscript.length > 0) {
    console.warn(`transcript unavailable: ${recovered.roomsWithoutTranscript.join(', ')}`)
  }
} catch (error) {
  console.warn(`message recovery failed: ${error?.message ?? error}`)
}

const compactHistory = () => {
  let activities = 0
  let events = 0
  for (const room of store.readRooms()) {
    if (room.demo === true) continue
    activities += store.pruneActivityMessages(room.id, { keep: 2000 })
    events += store.pruneEvents(room.id, { keep: 5000 })
  }
  if (activities > 0 || events > 0) console.log(`history compacted: ${activities} steps, ${events} events`)
}

const snapshotNow = reason => {
  try {
    compactHistory()
    mkdirSync(join(dataDir, 'backups'), { recursive: true })
    const file = join(dataDir, 'backups', `crew-${Date.now()}-${reason}.db`)
    store.backup(file)
    pruneBackups(dataDir, 10)
    snapshotMemory({ dataDir, reason, keep: 10 })
  } catch (error) {
    console.warn(`store backup failed: ${error?.message ?? error}`)
  }
}
compactHistory()
// 清掉 Lodge 数据库后，基座里旧房间的 bot/群不会自己消失；首次启动按 Lodge 标记一起清掉。
if (store.fresh === true && store.readRooms().length === 0) {
  try {
    const cleared = await clearLodgeBaseResources(createBaseClient())
    if (cleared.bots > 0 || cleared.groups > 0) {
      console.log(`base cleared after data reset: ${cleared.groups} groups, ${cleared.bots} bots`)
    }
    if (cleared.failures.length > 0) {
      console.warn(`base clear left ${cleared.failures.length} items: ${cleared.failures.slice(0, 3).join('；')}`)
    }
  } catch (error) {
    console.warn(`base clear after data reset failed: ${error?.message ?? error}`)
  }
}
setInterval(() => snapshotNow('periodic'), 6 * 60 * 60 * 1000).unref()

// 子房等人的事也要出现在父房的收件箱里，所以投影前先读一眼子房。
const attentionChildrenOf = room => (room.childRoomIds ?? [])
  .map(childId => store.readRoom(childId))
  .filter(child => child !== null)
  .map(child => ({ room: child, messages: store.readRecentMessages(child.id) }))

const routineRunOf = room => {
  const runId = room?.routine?.lastRoomId
  if (typeof runId !== 'string') return null
  const runRoom = store.readRoom(runId)
  if (runRoom === null) return null
  return { room: runRoom, messages: store.readRecentMessages(runRoom.id) }
}

// 工作室不再等人签字：阶段一通过就自动往下走，房间像聊天一样继续。
const autoAcceptPending = new Set()
const nudgeStudio = room => {
  if (service === null || room?.roomType !== 'studio' || room.state !== 'active' || room.demo === true) return
  const need = room.needsYou
  if (need === null || need === undefined || !Number.isInteger(need.stage)) return
  // 只自动收尾工作阶段；开工的决策阶段沿用建房/规划流程，避免抢跑。
  if (need.kind !== 'signoff') return
  const key = `${room.id}:${need.stage}`
  if (autoAcceptPending.has(key)) return
  autoAcceptPending.add(key)
  setTimeout(() => {
    autoAcceptPending.delete(key)
    service?.roomRequest(room.id, 'accept', {
      method: 'POST',
      readBody: async () => ({ stage: need.stage }),
    }).catch(error => console.warn(`[lodge] 自动确认阶段失败：${error?.message ?? error}`))
  }, 400)
}

// 房间事件和 /api/state 用同一份投影；UI 只消费 needsYou/独立性文案。
let progressWriter = null
const present = room => presentRoom(room, store.readRecentMessages(room.id), store.readAssignments(room.id, { limit: 500 }), {
  children: attentionChildrenOf(room),
  routineRun: routineRunOf(room),
})

const emit = (event, payload, id) => {
  if (event === 'room' && payload !== null && typeof payload?.id === 'string') {
    const runRoom = payload.routineGoalId !== undefined && payload.routineGoalId !== null
    payload = present(payload)
    nudgeStudio(payload)
    progressWriter?.(payload)
    broadcast(event, payload, id)
    // run 停下来等人时，提醒要落在目标房；run 自己有变化就同步一次目标房。
    if (runRoom) {
      const goal = store.readRoom(payload.routineGoalId)
      if (goal !== null) broadcast('room', present(goal), id)
    }
    return
  }
  broadcast(event, payload, id)
}

const engine = assertRuntimePort(createEngine())

let service = null
const ports = createCrewPorts({
  memoryRoot: join(dataDir, 'memory'),
  browserMcp: { ensure: () => ensureBrowserMcp(engine) },
})
progressWriter = room => {
  try {
    ports.roomFiles.writeProgress(room, store.readRecentMessages(room.id))
  } catch (error) {
    console.warn(`[lodge] 进度文件没有写入：${error?.message ?? error}`)
  }
}

const live = createLiveRooms({
  store,
  engine,
  emit,
  ports,
})

service = createCrewService({
  store,
  engine,
  live,
  emit,
  roles: ROLES,
  ports,
})

const runRoutine = createRoutineRunner({ store, service, emit })

// 持久 timer 到点后进房间 inbox，再由单 worker 处理；审批超时和例行工作都从这里恢复。
const scheduler = createRoomScheduler({ store, live, onRoutine: runRoutine })
scheduler.start()

const runWorkspaceGc = () => {
  try {
    const result = collectWorkspaceGarbage({ store, workspace: ports.workspace, files: ports.files })
    if (result.pruned > 0 || result.orphans > 0 || result.rewound > 0) {
      console.log(`workspace gc: pruned ${result.pruned} members, removed ${result.orphans} orphan dirs, pruned ${result.rewound} rewind branches`)
    }
  } catch (error) {
    console.warn(`workspace gc failed: ${error?.message ?? error}`)
  }
}
void runWorkspaceGc()
setInterval(runWorkspaceGc, 6 * 60 * 60 * 1000).unref()

const server = http.createServer(createHttpHandler({
  root,
  service,
  store,
  clients,
  send,
  chooseDirectory,
  openPath,
}))

const port = Number(process.env.CREW_PORT ?? 8787)
server.listen(port, '127.0.0.1', () => {
  console.log(`Lodge server: http://127.0.0.1:${port}`)
  void (async () => {
    await live.start()
  })()
})
