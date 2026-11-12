import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { budgetHint, budgetStatus, budgetSummary, globalBudgetStatus } from './budget.js'
import { simulateRoom } from './demo.js'
import { buildDelivery, deliveryMarkdown } from './delivery.js'
import { createDispatchService } from './dispatch-service.js'
import { presentRoom } from './presentation.js'
import { createRealRoom } from './room-create.js'
import { recommendRoster as recommendRosterUseCase } from './roster-recommend.js'
import { rosterFromRoles, TEMPLATE_LIST, validateRoster } from './seats.js'
import { gateFor } from './gates.js'
import { roomRootOf } from './paths.js'
import { accepted, BusinessError, created, fail, ok } from './result.js'
import {
  readBrief,
  roomDir,
  writeConclusion,
  writeGoal,
} from './room-repo.js'
import { buildHandoff, importHandoff } from './handoff.js'
import { readProjectConstraints } from './project.js'
import { resetMcpBreakers } from './mcp-breaker.js'
import { buildResources } from './resources.js'
import { aggregateUsage, readUsageHistory } from './usage-history.js'
import { buildReview } from './review.js'
import { parseTemplate } from './template.js'
import { workspaceProvider } from './workspace.js'

// 完成态留痕由工作区能力决定：commit、git 不可用、或只归档房间记录。
export const persistenceKind = capabilities => {
  if (capabilities?.commit === true) return 'commit'
  return capabilities?.vcs === 'git' ? 'git-unavailable' : 'archive'
}

export const acceptanceChangeError = (stage, command) => {
  if (stage === undefined) return ['invalid', '没有这个阶段']
  if (stage.kind !== 'deliverable') return ['invalid', '只有交付型阶段能设置验收命令']
  if (stage.state === 'passed') return ['conflict', '这个阶段已经过了']
  const trimmed = command.trim()
  if (trimmed.length > 500) return ['invalid', '验收命令不超过 500 字']
  if (trimmed === '' && stage.state === 'active') return ['conflict', '进行中的交付型阶段不能清空验收命令；先暂停或停止']
  return null
}

// 业务层：只见 store / live / 事件出口，不碰 HTTP，也不碰基座字段。
export const createCrewService = ({ store, engine, live, emit, dispatchPayload, seats, dataDir }) => {
  const { readRoom, readRooms, readMessages, readMessagesSince, writeRoom, updateRoom, appendMessage, appendEvent } = store
  const dispatch = createDispatchService({ store, emit, dispatchPayload })

  const health = async () => ok({ runtime: await engine.health() })

  const state = async () => {
    const rooms = readRooms()
    let engines = []
    try {
      engines = await engine.instances()
    } catch {
      engines = []
    }
    return {
      seats,
      templates: TEMPLATE_LIST,
      rooms: rooms.map(room => {
        const messages = readMessages(room.id)
        return { ...presentRoom(room, messages), brief: readBrief(room), messages }
      }),
      dispatch: dispatchPayload(),
      budget: budgetSummary(rooms),
      engines,
    }
  }

  const messagesSince = since => readMessagesSince(since)

  const evidence = (roomId, messageId) => {
    const room = readRoom(roomId)
    if (room === null) return fail('not_found', '没有这个房间')
    const file = join(roomDir(room), 'evidence', `${messageId}.json`)
    if (!existsSync(file)) return fail('not_found', '没有这份证据')
    return { ok: true, bytes: readFileSync(file) }
  }

  const createRoom = body => createRealRoom({ store, engine, live, emit, seats, dispatchPayload, body })

  const importTemplate = body => {
    try {
      return ok({ template: parseTemplate(body?.text, typeof body?.filename === 'string' ? body.filename : '') })
    } catch (error) {
      return fail('invalid', String(error?.message ?? error))
    }
  }

  const resetMcp = (roomId, body) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.imported === true) return fail('conflict', '交接记录只读')
    const server = typeof body?.server === 'string' && body.server !== '' ? body.server : null
    const updated = updateRoom(roomId, current => {
      current.mcpBreakers = resetMcpBreakers(current.mcpBreakers, server)
      return { events: [{ type: 'mcp.reset', payload: { server } }] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    appendMessage(roomId, {
      kind: 'system',
      text: server === null ? 'MCP 熔断已全部恢复。' : `MCP 熔断已恢复：${server}。`,
    })
    emit('room', updated)
    return ok({ room: updated })
  }

  const resources = () => ok({ resources: buildResources(readRooms(), readMessages) })

  const usage = range => ok({
    usage: aggregateUsage({ rooms: readRooms(), historyOf: readUsageHistory, range }),
  })

  const projectConstraints = repoPath => {
    const source = typeof repoPath === 'string' ? repoPath.trim() : ''
    if (source === '') return fail('invalid', '先填工作目录')
    const file = readProjectConstraints(source)
    return ok({
      path: file?.path ?? null,
      content: file?.content ?? null,
      layers: file?.layers ?? [],
    })
  }

  const review = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    return ok({ review: buildReview(room, readMessages(roomId)) })
  }

  const deliveryExport = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.state !== 'complete') return fail('conflict', '房间还没有完成，没有交付单')
    const delivery = buildDelivery(room, readMessages(roomId))
    return ok({
      filename: `${(room.name || room.id).replace(/[\\/:*?"<>|]/g, '-')}.交付单.md`,
      text: deliveryMarkdown(delivery),
    })
  }

  const handoff = roomId => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.demo === true) return fail('conflict', '演示房间没有写入房间仓库，不能导出交接包')
    const bundle = buildHandoff(room)
    if (bundle === null) return fail('conflict', '房间还没有 transcript.jsonl，不能导出交接包')
    return ok({ bundle })
  }

  const importHandoffPackage = bundle => {
    if (typeof dataDir !== 'string' || dataDir === '') throw new Error('服务未配置 dataDir，无法导入交接包')
    const result = importHandoff({ store, dataDir, bundle })
    if (result.ok !== true) return fail(result.reason, result.error)
    emit('room', result.room)
    for (const message of readMessages(result.room.id)) emit('msg', message, message.seq)
    emit('dispatch', dispatchPayload())
    return created({ room: result.room })
  }
  const recommendRoster = body => {
    const global = globalBudgetStatus(readRooms())
    if (!global.ok) return fail('conflict', global.message)
    return recommendRosterUseCase({ engine, body })
  }

  const setBudget = (room, body) => {
    const usd = Number(body.budgetUsd)
    if (!Number.isFinite(usd) || usd < 0) return fail('invalid', '预算必须是非负美元数')
    const budgetMicroUsd = usd === 0 ? 0 : Math.max(1, Math.round(usd * 1_000_000))
    let resumed = false
    const updated = updateRoom(room.id, current => {
      current.usage = { ...current.usage, budgetMicroUsd }
      const status = budgetStatus(current, readRooms())
      if (current.state === 'paused' && current.pauseReason === 'budget' && status.ok) {
        current.state = 'active'
        current.pauseReason = null
        current.budgetBlocked = false
        current.idle = false
        resumed = true
      } else if (current.state === 'active' && !status.ok) {
        current.state = 'paused'
        current.pauseReason = 'budget'
        current.budgetBlocked = true
        current.idle = false
      }
      return { events: [{ type: 'room.budget', payload: { budgetMicroUsd } }] }
    })
    if (updated === null) return fail('not_found', '没有这个房间')
    appendMessage(room.id, { kind: 'system', text: `房间预算已设为 ${usd === 0 ? '不限' : `$${usd.toFixed(2)}`}` })
    const status = budgetStatus(updated, readRooms())
    if (!resumed && !status.ok && updated.state !== 'stopped' && updated.state !== 'complete') {
      appendMessage(room.id, { kind: 'system', text: `预算已用尽：${status.message}；${budgetHint(status)}。` })
    }
    emit('room', updated)
    emit('dispatch', dispatchPayload())
    if (resumed) {
      const active = updated.stages.findIndex(stage => stage.state === 'active')
      const stage = updated.stages[active]
      if (updated.live === true && (stage?.kind === 'deliverable' || stage?.manual === true)) {
        const hasEvidence = readMessages(room.id).some(message => (
          message.kind === 'evidence' && (message.meta?.stage ?? 0) === active
        ))
        if (!hasEvidence && updated.busy !== true) {
          void live.startStage(updated, active).catch(error => {
            appendMessage(room.id, { kind: 'system', text: `继续执行失败：${error?.message ?? error}` })
          })
        }
      }
    }
    return ok({ room: updated })
  }

  // 建后加席位：工作区、基座席位线程、实时订阅和房间数组一起更新。
  const addSeat = async (room, body) => {
    if (room.imported === true) return fail('conflict', '交接记录只读')
    if (room.demo === true) return fail('conflict', '演示房间不能加席位')
    if (room.state !== 'active' && room.state !== 'paused') return fail('conflict', '房间结束后不能加席位')
    const role = body?.role === 'worker' || body?.role === 'verifier' ? body.role : ''
    if (role === '') return fail('invalid', '只能添加执行或验收席位')
    const specs = Array.isArray(room.seatSpecs) ? room.seatSpecs : []
    if (specs.length >= 8) return fail('conflict', '一个房间最多 8 个席位')
    const baseSeat = rosterFromRoles([{
      role,
      name: typeof body?.name === 'string' ? body.name : '',
    }])[0]
    const count = specs.filter(seat => seat.role === role).length
    const id = count === 0 ? role : `${role}-${count + 1}`
    const seat = { ...baseSeat, id }
    try {
      validateRoster([...specs, seat])
    } catch (error) {
      return fail('invalid', `席位不可用：${error?.message ?? error}`)
    }
    const workspace = workspaceProvider(room)
    if (typeof workspace.addSeat !== 'function') return fail('conflict', '当前工作区不支持建后加席位')
    const placement = workspace.addSeat({ room, seat })

    let requestedEngine = typeof body?.engine === 'string' && body.engine !== ''
      ? body.engine
      : seat.engineExplicit === true ? seat.engine : undefined
    if (role === 'verifier' && seat.engineExplicit !== true) {
      try {
        const instances = await engine.instances()
        const workerKinds = new Set((room.workers ?? []).map(worker => (
          instances.find(item => item.id === room.engines?.[worker])?.engine ?? room.engines?.[worker]
        )))
        const candidate = instances.find(item => item.available && !workerKinds.has(item.engine))
        if (candidate !== undefined) requestedEngine = candidate.id
      } catch {}
    }

    let seatRef = null
    let baseRoom = null
    try {
      seatRef = await engine.createSeatBot({
        name: `${id[0].toUpperCase()}${id.slice(1)}${room.id.slice(-6)}`,
        soul: seat.prompt,
        description: seat.station,
        approval: seat.approval,
        mcp: seat.mcp,
        engine: requestedEngine,
      })
      baseRoom = await engine.createRoom({
        name: `${room.name} · ${seat.name}`,
        goal: room.goal,
        bulletin: `目标：${room.goal}\n验收：${room.stages.map(stage => stage.acceptance).filter(Boolean).join(' / ') || '人确认'}`,
        members: [seatRef.id],
        cwd: placement.path,
        leadId: seatRef.id,
      })
    } catch (error) {
      if (baseRoom !== null) await engine.deleteRoom?.(baseRoom.id).catch(() => {})
      if (seatRef !== null) await engine.deleteSeatBot?.(seatRef.id).catch(() => {})
      throw error
    }

    const publicSpec = {
      id: seat.id,
      name: seat.name,
      title: seat.title,
      role: seat.role,
      station: seat.station,
      permissions: seat.permissions,
      writeScope: seat.writeScope,
      toolSurface: seat.toolSurface,
      skills: seat.skills,
      mcp: seat.mcp,
      approval: seat.approval,
      speakBudget: seat.speakBudget,
    }
    const updated = updateRoom(room.id, current => {
      current.seatSpecs = [...(current.seatSpecs ?? []), publicSpec]
      current.members = [...new Set([...(current.members ?? []), seat.id])]
      if (role === 'worker') current.workers = [...new Set([...(current.workers ?? []), seat.id])]
      else current.verifiers = [...new Set([...(current.verifiers ?? []), seat.id])]
      current.seatRooms = { ...(current.seatRooms ?? {}), [seat.id]: { id: baseRoom.id, sessionRef: baseRoom.sessionRef } }
      current.seatBots = { ...(current.seatBots ?? {}), [seat.id]: seatRef.id }
      current.seatNames = { ...(current.seatNames ?? {}), [seat.id]: seatRef.name }
      current.engines = { ...(current.engines ?? {}), [seat.id]: seatRef.engine }
      current.worktrees = { ...(current.worktrees ?? {}), [seat.id]: placement.path }
      current.ports = { ...(current.ports ?? {}), [seat.id]: placement.port }
      current.workspaceEnv = { ...(current.workspaceEnv ?? {}), [seat.id]: placement.environment }
      if (placement.branch !== null) current.branches = { ...(current.branches ?? {}), [seat.id]: placement.branch }
      current.seatCursors = { ...(current.seatCursors ?? {}), [seat.id]: 0 }
      if (seatRef.fallback === true) {
        current.engineFallbacks = {
          ...(current.engineFallbacks ?? {}),
          [seat.id]: { requested: seatRef.requestedEngine, actual: seatRef.engine, reason: seatRef.reason },
        }
      }
      if (role === 'verifier' && (current.verifiers ?? []).length === 1) current.independence = 'none'
      return { events: [{ type: 'room.seat_added', payload: { seat: seat.id, role, path: placement.path } }] }
    })
    if (updated === null) {
      await engine.deleteRoom?.(baseRoom.id).catch(() => {})
      await engine.deleteSeatBot?.(seatRef.id).catch(() => {})
      return fail('not_found', '房间不在了，席位没有加入')
    }
    if (typeof live.attachSeat === 'function') {
      try {
        await live.attachSeat(room.id, seat.id)
      } catch (error) {
        appendMessage(room.id, { kind: 'system', text: `席位已加入，但实时订阅失败：${error?.message ?? error}` })
      }
    }
    writeGoal(updated)
    appendMessage(room.id, {
      kind: 'system',
      text: `已加入${role === 'verifier' ? '验收' : '执行'}席位：${seat.name}（工作区 ${placement.path}）`,
    })
    emit('room', updated)
    return ok({ room: updated })
  }

  const removeSeatFromRoom = async (room, seatId) => {
    if (room.imported === true) return fail('conflict', '交接记录只读')
    if (room.demo === true) return fail('conflict', '演示房间不能移除席位')
    if (room.state !== 'active' && room.state !== 'paused') return fail('conflict', '房间结束后不能移除席位')
    const spec = (room.seatSpecs ?? []).find(seat => seat.id === seatId)
    if (spec === undefined) return fail('not_found', '没有这个席位')
    if (spec.role !== 'worker' && spec.role !== 'verifier') return fail('conflict', '只能移除执行或验收席位')
    if (spec.role === 'worker' && (room.workers ?? []).length <= 1) return fail('conflict', '至少要保留一个执行席位')
    if (spec.role === 'worker' && (room.workers ?? [])[0] === seatId) return fail('conflict', '交付席位不能直接移除；先完成或停止房间')
    if ((room.busySeats ?? []).includes(seatId) || room.busySeat === seatId) return fail('conflict', '这个席位正在跑回合，等结束后再移除')
    const workspace = workspaceProvider(room)
    if (typeof workspace.removeSeat !== 'function') return fail('conflict', '当前工作区不支持移除席位')
    const base = room.seatRooms?.[seatId]
    const seatRefId = room.seatBots?.[seatId]
    if (typeof live.detachSeat === 'function') live.detachSeat(room.id, seatId)
    if (base !== undefined) await engine.deleteRoom?.(base.id).catch(() => {})
    if (seatRefId !== undefined) await engine.deleteSeatBot?.(seatRefId).catch(() => {})
    try {
      workspace.removeSeat({ room, seat: spec })
    } catch (error) {
      appendMessage(room.id, { kind: 'system', text: `席位工作区清理失败：${error?.message ?? error}` })
    }
    const updated = updateRoom(room.id, current => {
      current.seatSpecs = (current.seatSpecs ?? []).filter(seat => seat.id !== seatId)
      current.members = (current.members ?? []).filter(id => id !== seatId)
      current.workers = (current.workers ?? []).filter(id => id !== seatId)
      current.verifiers = (current.verifiers ?? []).filter(id => id !== seatId)
      for (const key of ['seatRooms', 'seatBots', 'seatNames', 'engines', 'worktrees', 'ports', 'workspaceEnv', 'branches', 'seatCursors', 'engineFallbacks']) {
        if (current[key] !== undefined) {
          const next = { ...current[key] }
          delete next[seatId]
          current[key] = next
        }
      }
      current.stages = (current.stages ?? []).map(stage => (
        Array.isArray(stage.tasks) ? { ...stage, tasks: stage.tasks.filter(task => task.owner !== seatId) } : stage
      ))
      if ((current.verifiers ?? []).length === 0) {
        current.independence = (current.workers ?? []).length === 1 ? 'solo' : 'human'
      }
      return { events: [{ type: 'room.seat_removed', payload: { seat: seatId, role: spec.role } }] }
    })
    if (updated === null) return fail('not_found', '房间不在了')
    writeGoal(updated)
    appendMessage(room.id, { kind: 'system', text: `已移除席位：${spec.name}` })
    emit('room', updated)
    return ok({ room: updated })
  }

  const removeSeat = (roomId, seatId) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    return removeSeatFromRoom(room, seatId)
  }

  const control = async (room, action) => {
    if (action === 'pause' && room.state !== 'active') return fail('conflict', '只有进行中的房间能暂停')
    if (action === 'resume' && room.state !== 'paused') return fail('conflict', '这个房间没有暂停')
    if (action === 'stop' && room.state !== 'active' && room.state !== 'paused') {
      return fail('conflict', '这个房间已经结束')
    }
    if (action === 'resume') {
      const status = budgetStatus(room, readRooms())
      if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
    }
    const expected = room.state
    const nextState = action === 'pause' ? 'paused' : action === 'resume' ? 'active' : 'stopped'
    const updated = updateRoom(room.id, current => {
      if (current.state !== expected) return null
      current.state = nextState
      current.idle = false
      if (nextState === 'active') {
        current.noProgress = 0
        current.pauseReason = null
        current.budgetBlocked = false
      }
      if (nextState === 'paused') current.pauseReason = 'manual'
      return { events: [{ type: 'room.state', payload: { state: nextState, action } }] }
    })
    if (updated === null) return fail('conflict', '房间状态已变化，重试')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())

    const liveRoom = room.live === true
    let cancelled = false
    // 引擎能取消就真取消；不能取消时文案如实说明，不假装停下了。
    if (liveRoom && action !== 'resume') {
      try {
        cancelled = (await live.cancel({ roomId: room.id })).cancelled === true
      } catch {
        cancelled = false
      }
      live.expireApprovals(room.id, action === 'pause' ? '房间已暂停' : '房间已停止')
    }
    const note = action === 'pause'
      ? liveRoom
        ? cancelled
          ? '已暂停 · 基座里的回合已取消；已落盘的阶段与证据保留'
          : '已暂停 · 你的消息不再转发给基座；基座里正在跑的回合无法从这里中断'
        : '已暂停 · 阶段与证据保留，继续时从当前阶段接着走'
      : action === 'resume'
        ? '已继续 · 从当前阶段接着走'
        : liveRoom
          ? cancelled
            ? '已停止 · 基座里的回合已取消；已落盘的阶段与证据保留'
            : '已停止 · 你的消息不再转发给基座；已落盘的阶段与证据保留'
          : '已停止 · 已通过的阶段与证据保留，不会再派新活'
    appendMessage(room.id, { kind: 'system', text: note })
    if (action === 'resume' && liveRoom) {
      const active = room.stages.findIndex(stage => stage.state === 'active')
      const stage = room.stages[active]
      if (stage?.kind === 'deliverable' || stage?.manual === true) {
        const hasEvidence = readMessages(room.id).some(message => (
          message.kind === 'evidence' && (message.meta?.stage ?? 0) === active
        ))
        if (!hasEvidence && room.busy !== true) {
          void live.startStage(room, active).catch(error => {
            appendMessage(room.id, { kind: 'system', text: `继续执行失败：${error?.message ?? error}` })
          })
        }
      }
    }
    return ok({ room })
  }

  const completeRoom = room => {
    appendMessage(room.id, {
      kind: 'conclusion',
      authorId: 'planner',
      text: `目标达成：${room.goal}`,
      meta: {
        stages: room.stages.length,
        commands: room.stages.map(item => item.acceptance).filter(Boolean),
      },
    })
    appendEvent(room.id, 'room.conclusion', {
      stages: room.stages.length,
      commands: room.stages.map(item => item.acceptance).filter(Boolean),
    })
    if (room.demo === true) {
      appendMessage(room.id, { kind: 'system', text: '演示房间 · 不写 CONCLUSION.md，不产生 commit' })
      return room
    }
    writeConclusion(room)
    const archived = updateRoom(room.id, current => {
      current.pastGoals = [...(current.pastGoals ?? []), {
        goal: current.goal,
        stages: current.stages.map(stage => ({ title: stage.title, kind: stage.kind, state: stage.state })),
        completedAt: Date.now(),
      }].slice(-5)
      return { events: [{ type: 'goal.archived', payload: { stages: current.stages.length } }] }
    })
    if (archived !== null) emit('room', archived)
    const workspace = workspaceProvider(room)
    const capabilities = workspace.capabilities()
    const delivered = readMessages(room.id).flatMap(message => [
      ...(message.meta?.artifacts ?? []).map(artifact => artifact.path).filter(Boolean),
      ...(message.meta?.changedFiles ?? []).map(file => join(roomRootOf(room), file)),
    ])
    // 交付目录保留；只清掉非交付席位工作区。git 房间的候选分支仍在源仓库，可人工重建查看。
    try {
      const pruned = workspace.pruneSeats(room)
      const fresh = pruned.filter(seat => !(room.prunedSeats ?? []).includes(seat))
      if (fresh.length > 0) {
        const updated = updateRoom(room.id, current => {
          current.prunedSeats = pruned
          return { events: [{ type: 'room.prune', payload: { seats: fresh } }] }
        })
        if (updated !== null) {
          emit('room', updated)
          appendMessage(room.id, {
            kind: 'system',
            text: capabilities.vcs === 'git'
              ? `非交付工作区已清理：${fresh.join('、')}；候选分支保留在源仓库。`
              : `非交付工作区已清理：${fresh.join('、')}。`,
          })
        }
      }
    } catch (error) {
      appendMessage(room.id, { kind: 'system', text: `非交付工作区清理失败：${error?.message ?? error}` })
    }
    const persistence = persistenceKind(capabilities)
    if (persistence !== 'commit') {
      appendEvent(room.id, 'room.commit', {
        status: persistence === 'archive' ? 'archive' : 'unavailable',
        vcs: capabilities.vcs ?? 'none',
      })
      appendMessage(room.id, {
        kind: 'system',
        text: persistence === 'archive'
          ? '已写入 CONCLUSION.md · 当前工作区无版本控制，房间记录与交接包留痕'
          : '已写入 CONCLUSION.md · 本机 git 不可用，未产生 commit',
      })
      return store.readRoom(room.id) ?? room
    }
    // 先落这条完成记录，再提交，避免提交后 transcript 又变脏。
    appendMessage(room.id, {
      kind: 'system',
      text: capabilities.vcs === 'git'
        ? '已写入 CONCLUSION.md · 本地 commit 一次 · 未 push'
        : '已写入 CONCLUSION.md · 已归档一次交付记录',
    })
    const committed = workspace.persistRoom({ room, files: delivered })
    appendEvent(room.id, 'room.commit', { status: committed ? 'done' : 'failed', vcs: capabilities.vcs })
    if (!committed) {
      appendMessage(room.id, { kind: 'system', text: capabilities.vcs === 'git' ? 'commit 失败，详见服务端日志' : '交付记录归档失败，详见服务端日志' })
    }
    let commitHash = null
    if (committed && capabilities.commit === true) {
      try {
        commitHash = workspace.head({ path: roomRootOf(room) })
      } catch {
        commitHash = null
      }
    }
    const finalized = updateRoom(room.id, current => {
      current.completedAt = current.completedAt ?? Date.now()
      if (commitHash !== null) current.completedCommit = commitHash
      return { events: [] }
    })
    if (finalized !== null) emit('room', finalized)
    return finalized ?? store.readRoom(room.id) ?? room
  }

  const accept = (room, body) => {
    const index = Number(body.stage)
    let gate = null
    let next = -1
    const updated = updateRoom(room.id, current => {
      gate = gateFor(current, index, readMessages(room.id))
      if (!gate.ok) return null
      const stage = current.stages[index]
      stage.state = 'passed'
      if (Array.isArray(stage.tasks)) stage.tasks = stage.tasks.map(task => ({ ...task, status: 'done' }))
      next = current.stages.findIndex(item => item.state === 'pending')
      if (next >= 0) current.stages[next].state = 'active'
      else current.state = 'complete'
      return {
        events: [
          { type: 'stage.passed', payload: { stage: index, kind: stage.kind, by: 'you' } },
          ...(next < 0 ? [{ type: 'room.complete', payload: {} }] : []),
        ],
      }
    })
    if (gate !== null && gate.ok === false) return fail(gate.reason, gate.error)
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    emit('dispatch', dispatchPayload())
    appendMessage(room.id, {
      kind: 'system',
      text: gate.stage.kind === 'deliverable'
        ? `阶段 ${index + 1} 已按证据验收`
        : `阶段 ${index + 1} 已由你确认`,
      meta: { kind: 'gate', gate: gate.stage.kind, stage: index, by: 'you' },
    })
    let finalRoom = next < 0 ? completeRoom(room) ?? room : room
    if (next >= 0 && room.live === true && room.stages[next]?.kind === 'deliverable' && typeof live.startStage === 'function') {
      const status = budgetStatus(room, readRooms())
      if (!status.ok) {
        const paused = updateRoom(room.id, current => {
          if (current.state !== 'active') return null
          current.state = 'paused'
          current.pauseReason = 'budget'
          current.budgetBlocked = true
          current.idle = false
          return { events: [{ type: 'room.budget_pause', payload: { reason: status.roomBlocked ? 'room' : 'global' } }] }
        })
        if (paused !== null) {
          appendMessage(room.id, {
            kind: 'system',
            text: `预算已用尽：${status.message}；下一阶段已暂停，${budgetHint(status)}。`,
          })
          emit('room', paused)
          emit('dispatch', dispatchPayload())
          finalRoom = paused
        }
      } else {
        void live.startStage(room, next).catch(error => {
          appendMessage(room.id, { kind: 'system', text: `启动执行失败：${error?.message ?? error}` })
        })
      }
    }
    return ok({ room: finalRoom })
  }

  const setAcceptance = (room, index, command) => {
    let rejection = null
    const updated = updateRoom(room.id, current => {
      const stage = current.stages[index]
      const invalid = acceptanceChangeError(stage, command)
      if (invalid !== null) {
        rejection = invalid
        return null
      }
      const trimmed = command.trim()
      if (trimmed === '') delete stage.acceptance
      else stage.acceptance = trimmed
      return { events: [{ type: 'stage.acceptance', payload: { stage: index, command: stage.acceptance ?? '' } }] }
    })
    if (rejection !== null) return fail(rejection[0], rejection[1])
    if (updated === null) return fail('not_found', '没有这个房间')
    room = updated
    if (!room.demo) writeGoal(room)
    emit('room', room)
    const trimmed = command.trim()
    const message = appendMessage(room.id, {
      kind: 'system',
      text: trimmed === ''
        ? `阶段 ${index + 1} 的验收命令已清空`
        : `阶段 ${index + 1} 的验收命令：\`${trimmed}\``,
    })
    return ok({ room, message })
  }

  const roomRequest = async (roomId, action, { method, readBody = async () => ({}) }) => {
    const room = readRoom(roomId)
    if (room === null || room.kind !== 'room') return fail('not_found', '没有这个房间')
    if (room.imported === true) return fail('conflict', '交接记录只读；要继续工作，请对照 BRIEF 与证据新建房间')

    if ((action === 'pause' || action === 'resume' || action === 'stop') && method === 'POST') {
      return control(room, action)
    }

    if (action === 'seats' && method === 'POST') {
      return addSeat(room, await readBody())
    }

    if (action === 'approvals' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间有基座权限卡')
      if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
      const body = await readBody()
      const approvalId = typeof body.id === 'string' ? body.id : ''
      const decision = body.decision === 'allow' ? 'allow' : body.decision === 'deny' ? 'deny' : ''
      if (approvalId === '') return fail('invalid', '缺少审批 id')
      if (decision === '') return fail('invalid', '审批只接受 allow/deny')
      const result = await live.decideApproval(room.id, approvalId, decision)
      if (result.ok !== true) return fail('conflict', result.reason)
      return ok({ room: result.room })
    }

    if (action === 'budget' && method === 'POST') {
      return setBudget(room, await readBody())
    }

    if (action === 'acceptance' && method === 'POST') {
      const body = await readBody()
      return setAcceptance(room, Number(body.stage), typeof body.command === 'string' ? body.command : '')
    }

    if (action === 'verify' && method === 'POST') {
      if (room.live !== true) return fail('conflict', '只有实时房间能用引擎复核；演示房间请用模拟执行')
      if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
      const status = budgetStatus(room, readRooms())
      if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
      const body = await readBody()
      try {
        return accepted(await live.requestReview(room.id, Number(body.stage)))
      } catch (error) {
        if (error instanceof BusinessError) return fail(error.reason, error.message)
        throw error
      }
    }

    if (room.state === 'paused' || room.state === 'stopped') {
      if (room.state === 'paused' && room.pauseReason === 'budget') {
        const status = budgetStatus(room, readRooms())
        return fail('conflict', `${status.message}；${budgetHint(status)}`)
      }
      return fail('conflict', room.state === 'paused' ? '房间已暂停' : '房间已停止')
    }

    if (action === 'messages' && method === 'POST') {
      const body = await readBody()
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (text === '' || text.length > 8000) return fail('invalid', '消息不能为空，且不超过 8000 字')
      if (room.live === true) {
        if (live.isAttached(room.id) !== true) return fail('conflict', '这个旧版实时房间不再绑定；请新建一个真实房间')
        if (live.busyReview(room.id)) return fail('conflict', '复核进行中，先等验收结论')
        const status = budgetStatus(room, readRooms())
        if (!status.ok) return fail('conflict', `${status.message}；${budgetHint(status)}`)
        await live.send(room.id, text)
        return accepted({ accepted: true })
      }
      const message = appendMessage(roomId, { kind: 'chat', authorId: 'you', text })
      const active = room.stages.find(stage => stage.state === 'active')
      if (room.openQuestion !== null && active?.kind === 'decision') {
        room.openQuestion = null
        writeRoom(room)
        emit('room', room)
        emit('dispatch', dispatchPayload())
      }
      return created({ message })
    }

    if (action === 'accept' && method === 'POST') {
      return accept(room, await readBody())
    }

    if (action === 'simulate' && method === 'POST') {
      return simulateRoom({ readMessages, appendMessage, room })
    }

    return fail('method', '方法不对')
  }

  return {
    state,
    health,
    messagesSince,
    evidence,
    resetMcp,
    resources,
    usage,
    projectConstraints,
    importTemplate,
    review,
    deliveryExport,
    removeSeat,
    handoff,
    importHandoff: importHandoffPackage,
    createRoom,
    recommendRoster,
    roomRequest,
    dispatchRequest: dispatch.request,
  }
}
