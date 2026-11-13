import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { budgetHint, globalBudgetStatus, roomBudgetFromBody } from './budget.js'
import { created, fail } from './result.js'
import { effectiveAcceptanceOf, normalizePlan, normalizeRequest, projectSnapshot, resolveSeats, resolveStageAssignees } from './room-create-input.js'
import { startInitialStage } from './room-create-start.js'
import { buildRoomRecord, initialRoomMessages } from './room-record.js'
import { createProvisioner } from './room-provision.js'
import { prepareWorkspace, resolveWorkspaceProvider } from './room-workspace.js'

export { inheritedPlan } from './room-create-input.js'

// 模板驱动建房：模板只是起点；roster 可以按需组合角色，每个席位一个基座线程与工作区。
export const createRealRoom = async ({ store, engine, live, emit, dispatchPayload, body, workspace = null, ports }) => {
  const request = normalizeRequest(body)
  if (request.error !== undefined) return fail('invalid', request.error)
  const { goal, name, roomType, verify, acceptance, orchestration } = request
  let continueSource = null
  if (typeof body.continueFrom === 'string' && body.continueFrom !== '') {
    continueSource = store.readRoom(body.continueFrom)
    if (continueSource === null || continueSource.kind !== 'room') return fail('not_found', '没有这个房间')
    if (!['complete', 'active', 'paused'].includes(continueSource.state)) {
      return fail('conflict', '只有进行中、已暂停、已完成房间可以作为续做/分叉起点')
    }
  }
  const capabilities = engine.capabilities()
  if (capabilities.provisioning !== true) return fail('conflict', '当前 runtime 不支持从界面建房')
  const globalBudget = globalBudgetStatus(store.readRooms())
  if (!globalBudget.ok) return fail('conflict', `${globalBudget.message}；${budgetHint(globalBudget)}`)
  const budgetMicroUsd = roomBudgetFromBody(body)

  const { plan, error: planError } = normalizePlan({ body, continueSource, roomFiles: ports.roomFiles })
  if (planError !== undefined) return fail('invalid', planError)
  const effectiveAcceptance = effectiveAcceptanceOf(acceptance, plan)
  const seatsResult = resolveSeats(body, roomType)
  if (seatsResult.error !== undefined) return fail('invalid', seatsResult.error)
  const { templateId, roster, workers, verifiers, worker, lead, align } = seatsResult
  if (roomType.id === 'studio' && typeof roomType.validateRoster === 'function') {
    try {
      roomType.validateRoster(roster, { verify })
    } catch (error) {
      return fail('invalid', `席位组合不可用：${error?.message ?? error}`)
    }
  }
  const resolvedPlan = roomType.id === 'chat' ? null : resolveStageAssignees(plan, roster)
  if (verify === 'manual' && verifiers.length > 0 && !['studio', 'chat'].includes(roomType.id)) {
    return fail('invalid', '人工验收模式不需要验收席位；要独立复核就补一条验收命令')
  }
  for (const seat of roster) {
    const missingSkills = seat.skills.filter(id => ports.skills?.has?.(id) !== true)
    if (missingSkills.length > 0) {
      return fail('invalid', `未知技能：${missingSkills.join('、')}；先放入 templates/skills`)
    }
    if (seat.mcp.length > 0 && capabilities.mcp !== true) {
      return fail('conflict', '当前 runtime 不支持 MCP')
    }
  }

  const short = randomUUID().slice(0, 6)
  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  if (continueSource !== null && requestedRepo === '') {
    return fail('invalid', '续做要指定上一轮交付所在的本地仓库或目录；交接包本身不含代码')
  }
  const sourceRepo = requestedRepo === '' ? join(ports.workspace.root(), `room-${short}`) : resolve(requestedRepo)
  const providerResult = resolveWorkspaceProvider({ body, workspace, requestedRepo, sourceRepo, workspacePort: ports.workspace })
  if (providerResult.error !== undefined) return fail('invalid', providerResult.error)
  const provider = providerResult.provider
  const workspaceCaps = provider.capabilities()
  if (roomType.readOnly !== true && workers.length > 1 && workspaceCaps.merge !== true) {
    return fail('conflict', '当前工作区不支持并行合并；先只保留一个执行席位')
  }
  const { projectFile, projectContent } = projectSnapshot(body, sourceRepo, ports.project)
  const workspaces = prepareWorkspace({ provider, sourceRepo, short, roster, workspacePort: ports.workspace })

  const provisioner = createProvisioner({ engine })
  let room = null
  let stored = false
  try {
    const goalTitle = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
    const title = name === '' ? goalTitle : name
    const provisioned = await provisioner.provision({
      roster,
      short,
      title,
      goal,
      verify,
      acceptance: effectiveAcceptance,
      align,
      workspaces,
      verifiers,
    })
    const builtStages = roomType.buildStages({ title: goalTitle, plan: resolvedPlan, verify, acceptance, align })
    room = buildRoomRecord({
      short,
      title,
      goal,
      templateId,
      plan: resolvedPlan,
      independence: provisioned.independence,
      engines: provisioned.engines,
      models: provisioned.models,
      engineFallbacks: provisioned.engineFallbacks,
      seatBots: provisioned.seatBots,
      seatNames: provisioned.seatNames,
      seatRooms: provisioned.seatRooms,
      chatRoom: provisioned.chatRoom,
      lead,
      workers,
      verifiers,
      sourceRepo,
      workspaces,
      provider,
      workspaceCaps,
      continueSource,
      budgetMicroUsd,
      projectContent,
      projectFile,
      projectPort: ports.project,
      roomType,
      orchestration: orchestration.id,
      builtStages,
      roster,
      align,
      verify,
      acceptance,
    })
    if (Array.isArray(body.stageDependencies)) {
      room.stages = room.stages.map((stage, index) => {
        const raw = body.stageDependencies[index]
        if (!Array.isArray(raw)) return stage
        const dependsOn = [...new Set(raw.filter(item => (
          Number.isInteger(item) && item >= 0 && item < room.stages.length && item !== index
        )))]
        return dependsOn.length === 0 ? stage : { ...stage, dependsOn }
      })
    }
    store.writeRoom(room)
    stored = true
    store.appendEvent(room.id, 'room.created', { live: true, templateId, seats: room.members, sourceRepo, branch: room.branch })
    ports.roomFiles.writeBrief(room, resolvedPlan)
    ports.roomFiles.writeGoal(room)
    for (const message of initialRoomMessages({
      room,
      plan: resolvedPlan,
      templateId,
      roster,
      builtStages,
      continueSource,
      projectContent,
      projectFile,
      workspaces,
      engineFallbacks: provisioned.engineFallbacks,
    })) {
      store.appendMessage(room.id, message)
    }
    await live.attach(room, { resume: false })
    emit('dispatch', dispatchPayload())
    room = await startInitialStage({
      store,
      live,
      room,
      plan: resolvedPlan,
      align,
      workers,
      lead,
      worker,
      roster,
      goal,
      verify,
      effectiveAcceptance,
      autoStart: roomType.autoStart,
      emit,
    })
    room = store.readRoom(room.id) ?? room
    emit('room', room)
    return created({ room })
  } catch (error) {
    if (!stored) {
      await provisioner.cleanup()
      provider.cleanupRoom({ source: sourceRepo, workspaces })
      throw new Error(`建房失败：${error?.message ?? error}`)
    }
    store.appendMessage(room.id, { kind: 'system', text: `房间已建，但启动失败：${error?.message ?? error}` })
    return created({ room, warning: String(error?.message ?? error) })
  }
}
