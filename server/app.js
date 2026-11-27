import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { fstatSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createCrewPorts } from './crew/crew-ports.js'
import { createLiveRooms } from './crew/rooms/live/live.js'
import { createRoomScheduler } from './crew/rooms/scheduler.js'
import { ensureLodgeRoom } from './crew/rooms/lodge.js'
import { acquireDataLock } from './crew/lock.js'
import { presentRoom } from './crew/presentation.js'
import { roundSummaryOf } from './crew/rounds/record.js'
import { reconcileRounds } from './crew/rounds/recovery.js'
import { createCrewService } from './crew/service.js'
import { openPath } from './system-open.js'
import { createHttpHandler } from './http.js'
import { collectWorkspaceGarbage } from './crew/workspace-gc.js'
import { ROLES, validateRoster } from './crew/roster.js'
import { assertLivePort, assertRuntimePort } from './crew/runtime-port.js'
import { compactAssignments } from './crew/assignment-history.js'
import { createStore } from './crew/store.js'
import { createBaseClient } from './base.js'
import { createSkillPackGate, ensureRoleSkillPacks } from './skill-packs.js'
import { ensureBrowserMcp } from './browser-mcp.js'
import { studioFindings } from './crew/rooms/studio/runtime/state-guard.js'
import { ensureDesktopMcp } from './desktop-mcp.js'
import { clearLodgeBaseResources } from './base-gc.js'
import { createEngine } from './engine.js'
import { chooseDirectory } from './system-dialog.js'
import { recoverMessages } from './crew/recovery.js'
import { pruneBackups, snapshotDatabase, snapshotMemory } from './crew/data-recovery.js'
import { createStudioAutoAcceptor } from './crew/rooms/studio/plan/auto-accept.js'
import { createListenerWatch, rebindOnce } from './listener-watch.js'
import { captureListenerReport } from './listener-report.js'
import { createStuckAudit } from './crew/rooms/studio/plan/stuck-audit.js'

// 唯一的装配点：配置、存储、引擎、房间和 HTTP 都从这里注入。
// 进程入口只负责 listen、信号和退出，不再自己读状态或创建 Agent。
export const createLodgeApp = async ({ root, env = process.env, onListenerLost = null } = {}) => {
  validateRoster(ROLES)
  const dataDir = env.CREW_DATA_DIR === undefined ? join(root, '.data') : resolve(env.CREW_DATA_DIR)
  const releaseLock = acquireDataLock(dataDir)
  try {
    return await buildApp({ root, env, dataDir, releaseLock, onListenerLost })
  } catch (error) {
    releaseLock()
    throw error
  }
}

const buildApp = async ({ root, dataDir, env, releaseLock, onListenerLost = null }) => {
  // 桌面版由 Electron 主进程代理写操作；令牌只活在进程内，不写环境、不上日志。
  const actionToken = env.LODGE_DESKTOP === '1' ? randomUUID() : null
  const clients = new Set()
  let service = null
  let progressWriter = null
  let autoAccept = null
  let snapshotTimer = null
  let gcTimer = null
  let stopped = false

  const send = (res, event, payload, id) => {
    res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
  }
  const broadcast = (event, payload, id) => {
    for (const client of clients) send(client, event, payload, id)
  }

  // schema 校验前先对旧库做快照；CLI 恢复也用同一份快照格式。
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

  const store = createStore({ dataDir, emit: broadcast, roundGuard: studioFindings })
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
  snapshotTimer = setInterval(() => snapshotNow('periodic'), 6 * 60 * 60 * 1000)
  snapshotTimer.unref?.()

  // 房间事件和 /api/state 用同一份投影；UI 只消费 needsYou/独立性文案。
  const present = room => ({
    ...presentRoom(room, store.readRecentMessages(room.id), store.readAssignments(room.id, { limit: 500 })),
    rounds: store.readWorkRounds(room.id).map(roundSummaryOf),
  })

  const emit = (event, payload, id) => {
    if (event === 'room' && payload !== null && typeof payload?.id === 'string') {
      payload = present(payload)
      autoAccept?.accept(payload)
      progressWriter?.(payload)
      broadcast(event, payload, id)
      return
    }
    broadcast(event, payload, id)
  }

  const engine = assertRuntimePort(createEngine())

  reconcileRounds({ store, emit })
  store.reclaimWork?.()
  // 附件走基座自己的库；图片能被原生视觉模型看见，文件保留路径和文本正文。
  const baseForAttachments = createBaseClient()
  // 基座可能比 Lodge 晚起来；失败不能把整次进程判死，建房时再试一次。
  const ensureSkillPacks = createSkillPackGate({
    ensure: () => ensureRoleSkillPacks({ client: baseForAttachments, root }),
    log: message => console.warn(`[lodge] ${message}`),
  })
  await ensureSkillPacks()

  const ports = createCrewPorts({
    memoryRoot: join(dataDir, 'memory'),
    browserMcp: { ensure: () => ensureBrowserMcp(engine) },
    desktopMcp: { ensure: () => ensureDesktopMcp(engine) },
    attachments: baseForAttachments,
    roleSkills: { ready: ensureSkillPacks },
    // 证明/反例由基座在边界里跑；Lodge 自己不再 spawn agent 命令。
    runSandboxed: payload => baseForAttachments.runSandboxed(payload),
  })
  progressWriter = room => {
    try {
      ports.roomFiles.writeProgress(room, store.readRecentMessages(room.id))
    } catch (error) {
      console.warn(`[lodge] 进度文件没有写入：${error?.message ?? error}`)
    }
  }

  const live = createLiveRooms({ store, engine, emit, ports })
  // 房型引擎直接调这些方法；缺了就在启动时说清楚，不等真实房间跑到一半报一条“服务错误”。
  assertLivePort(live)
  service = createCrewService({
    store,
    engine,
    live,
    emit,
    roles: ROLES,
    ports,
    attachments: baseForAttachments,
  })
  autoAccept = createStudioAutoAcceptor({
    accept: (room, stage) => service.roomRequest(room.id, 'accept', {
      method: 'POST',
      readBody: async () => ({ stage }),
    }),
    onError: (room, stage, error) => {
      console.warn(`[lodge] 自动确认阶段失败：${error?.message ?? error}`)
      try {
        store.appendMessage(room.id, {
          kind: 'system',
          text: `这一步还没能自动确认：${String(error?.message ?? error).slice(0, 200)}`,
        })
      } catch {}
    },
  })

  // 所有阶段都已通过、只差收尾的轮次，启动时补一次交付。
  try {
    const completed = service.reconcileCompletion()
    if (completed > 0) console.log(`[lodge] 收到结果后补交付：${completed} 轮`)
  } catch (error) {
    console.warn(`[lodge] 启动补交付失败：${error?.message ?? error}`)
  }

  // 持久 timer 到点后进房间 inbox，再由单 worker 处理；审批超时也从这里恢复。
  const scheduler = createRoomScheduler({ store, live })
  const runWorkspaceGc = () => {
    try {
      const result = collectWorkspaceGarbage({ store, workspace: ports.workspace, files: ports.files })
      if (result.pruned > 0 || result.orphans > 0 || result.rewound > 0 || result.temp > 0) {
        console.log(`workspace gc: pruned ${result.pruned} members, removed ${result.orphans} orphan dirs, pruned ${result.rewound} rewind branches, removed ${result.temp} temp proof copies`)
      }
    } catch (error) {
      console.warn(`workspace gc failed: ${error?.message ?? error}`)
    }
  }
  void runWorkspaceGc()
  gcTimer = setInterval(runWorkspaceGc, 6 * 60 * 60 * 1000)
  gcTimer.unref?.()
  // 卡住的房间不写库，写点上的不变量看不到它：定期扫一遍，只记影子告警。
  const stuckAudit = createStuckAudit({ store })
  const stuckTimer = setInterval(() => { stuckAudit.audit() }, 60_000)
  stuckTimer.unref?.()

  const server = http.createServer(createHttpHandler({
    root,
    service,
    store,
    clients,
    send,
    chooseDirectory,
    openPath,
    actionToken,
  }))
  const port = Number(env.CREW_PORT ?? 8787)
  // 监听消失时进程往往还活着：房间照跑、界面全白。自检发现连续连不上时，先拍现场、再重建；
  // 重建也起不来就交回入口退出——不留下一个不响应的进程。
  let rebinding = false
  const rebind = () => rebindOnce(server, { port })
  const listenerWatch = createListenerWatch({
    port,
    onLost: () => {
      if (rebinding) return
      rebinding = true
      void (async () => {
        // 先拍现场再重建：重建会把监听状态抹掉，事后就查不出是谁关的。
        await captureListenerReport({ dataDir, port, server }).catch(() => {})
        const ok = await rebind().catch(() => false)
        rebinding = false
        if (ok) {
          console.error('[lodge] 监听已重建')
          listenerWatch.reset()
          return
        }
        onListenerLost?.()
      })()
    },
  })
  server.once('listening', () => listenerWatch.start())

  // fd 级看门狗：现场里出现过「server.listening 还是 true、句柄 fd 已经关了或被复用」。
  // 自连探活要两个 30 秒周期才发现；这里每 2 秒问一次内核，连续两次不对就立刻走同一条上报路径。
  let fdSuspect = 0
  let fdChecking = false
  const fdWatch = setInterval(() => {
    const fd = server._handle?.fd
    if (!Number.isInteger(fd) || fd < 0) return
    let broken = false
    try {
      broken = !fstatSync(fd).isSocket()
    } catch (error) {
      broken = error?.code === 'EBADF'
    }
    if (!broken) {
      fdSuspect = 0
      return
    }
    fdSuspect += 1
    if (fdSuspect < 2 || fdChecking) return
    fdSuspect = 0
    fdChecking = true
    // 交给同一条上报路径：先拍现场（现在会带 fd 的内核状态），再重建。
    void Promise.resolve(listenerWatch.tick()).finally(() => { fdChecking = false })
  }, 2_000)
  fdWatch.unref?.()

  const ensureLodge = async attempt => {
    if (stopped) return
    try {
      await ensureLodgeRoom({ store, engine, live, workspace: ports.workspace, emit })
    } catch (error) {
      console.warn(`[lodge] Lodge 房间没有准备好：${error?.message ?? error}`)
      const delay = Math.min(2000 * 2 ** Math.min(attempt, 5), 60_000)
      setTimeout(() => { void ensureLodge(attempt + 1) }, delay).unref?.()
    }
  }

  const start = async () => {
    if (stopped) return
    // 先把房间接上，再让调度器领活；否则租约可能在 attach 前被领走并当成处理完。
    try {
      await live.start()
    } catch (error) {
      console.warn(`[lodge] 房间连接没有启动：${error?.message ?? error}`)
    }
    scheduler.start()
    await ensureLodge(0)
  }

  const stop = async () => {
    if (stopped) return
    stopped = true
    listenerWatch.stop()
    clearInterval(fdWatch)
    clearInterval(stuckTimer)
    autoAccept?.stop()
    if (snapshotTimer !== null) clearInterval(snapshotTimer)
    if (gcTimer !== null) clearInterval(gcTimer)
    scheduler.stop()
    for (const client of clients) {
      try { client.end() } catch {}
    }
    clients.clear()
    await new Promise(resolve => {
      if (!server.listening) return resolve()
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
    releaseLock()
  }

  return { server, store, service, dataDir, port, actionToken, start, stop, listenerWatch }
}
