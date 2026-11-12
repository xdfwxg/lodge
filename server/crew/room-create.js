import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { budgetHint, globalBudgetStatus, roomBudgetFromBody } from './budget.js'
import { workspaceRoot } from './paths.js'
import { created, fail } from './result.js'
import { writeBrief, writeGoal } from './room-repo.js'
import { resolveRoomType } from './room-types/index.js'
import { effectiveAcceptanceOf, normalizePlan, projectSnapshot, resolveSeats } from './room-create-input.js'
import { startInitialStage } from './room-create-start.js'
import { buildRoomRecord, initialRoomMessages } from './room-record.js'
import { createProvisioner } from './room-provision.js'
import { prepareWorkspace, resolveWorkspaceProvider } from './room-workspace.js'

export { inheritedPlan } from './room-create-input.js'

// 模板驱动建房：模板只是起点；roster 可以按需组合角色，每个席位一个基座线程与工作区。
export const createRealRoom = async ({ store, engine, live, emit, dispatchPayload, body, workspace = null }) => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return fail('invalid', '目标不能为空，且不超过 2000 字')
  const roomType = resolveRoomType(body.roomType)
  if (roomType === null) return fail('invalid', '未知的房间类型')
  const normalized = roomType.normalize({
    body,
    verify: body.verify === 'manual' ? 'manual' : 'test',
    acceptance: typeof body.acceptance === 'string' ? body.acceptance.trim() : '',
  })
  const verify = normalized.verify
  const acceptance = typeof normalized.acceptance === 'string' ? normalized.acceptance.trim() : ''
  const plannedAcceptance = Array.isArray(body.plan?.stages)
    ? body.plan.stages.some(stage => typeof stage?.acceptance === 'string' && stage.acceptance.trim() !== '')
    : false
  if (verify === 'test' && acceptance === '' && !plannedAcceptance) {
    return fail('invalid', '交付型房间需要一条验收命令')
  }
  let continueSource = null
  if (typeof body.continueFrom === 'string' && body.continueFrom !== '') {
    continueSource = store.readRoom(body.continueFrom)
    if (continueSource === null || continueSource.kind !== 'room') return fail('not_found', '没有这个交接记录')
    if (continueSource.imported !== true && !['complete', 'active', 'paused'].includes(continueSource.state)) {
      return fail('conflict', '只有进行中、已暂停、已完成房间或导入记录可以作为续做/分叉起点')
    }
  }
  if (engine.capabilities().provisioning !== true) return fail('conflict', '当前 runtime 不支持从界面建房')
  const globalBudget = globalBudgetStatus(store.readRooms())
  if (!globalBudget.ok) return fail('conflict', `${globalBudget.message}；${budgetHint(globalBudget)}`)
  const budgetMicroUsd = roomBudgetFromBody(body)

  const { plan, error: planError } = normalizePlan({ body, continueSource })
  if (planError !== undefined) return fail('invalid', planError)
  const effectiveAcceptance = effectiveAcceptanceOf(acceptance, plan)
  const seatsResult = resolveSeats(body, roomType)
  if (seatsResult.error !== undefined) return fail('invalid', seatsResult.error)
  const { templateId, roster, workers, verifiers, worker, lead, align } = seatsResult
  if (verify === 'manual' && verifiers.length > 0) {
    return fail('invalid', '人工验收模式不需要验收席位；要独立复核就补一条验收命令')
  }

  const short = randomUUID().slice(0, 6)
  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  if (continueSource !== null && requestedRepo === '') {
    return fail('invalid', '续做要指定上一轮交付所在的本地仓库或目录；交接包本身不含代码')
  }
  const sourceRepo = requestedRepo === '' ? join(workspaceRoot(), `room-${short}`) : resolve(requestedRepo)
  const providerResult = resolveWorkspaceProvider({ body, workspace, requestedRepo, sourceRepo })
  if (providerResult.error !== undefined) return fail('invalid', providerResult.error)
  const provider = providerResult.provider
  const workspaceCaps = provider.capabilities()
  if (workers.length > 1 && workspaceCaps.merge !== true) {
    return fail('conflict', '当前工作区不支持并行合并；先只保留一个执行席位')
  }
  const { projectFile, projectContent } = projectSnapshot(body, sourceRepo)
  const workspaces = prepareWorkspace({ provider, sourceRepo, short, roster })

  const capabilities = engine.capabilities()
  for (const seat of roster) {
    if (seat.skills.length > 0 && capabilities.skills !== true) {
      return fail('conflict', '当前 runtime 还不能安装技能；先不要给席位声明技能')
    }
    if (seat.mcp.length > 0 && capabilities.mcp !== true) {
      return fail('conflict', '当前 runtime 不支持 MCP')
    }
  }

  const provisioner = createProvisioner({ engine })
  let room = null
  let stored = false
  try {
    const title = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
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
    const builtStages = roomType.buildStages({ title, plan, verify, acceptance, align })
    room = buildRoomRecord({
      short,
      title,
      goal,
      templateId,
      plan,
      independence: provisioned.independence,
      engines: provisioned.engines,
      engineFallbacks: provisioned.engineFallbacks,
      seatBots: provisioned.seatBots,
      seatNames: provisioned.seatNames,
      seatRooms: provisioned.seatRooms,
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
      roomType,
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
    writeBrief(room, plan)
    writeGoal(room)
    for (const message of initialRoomMessages({
      room,
      plan,
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
    await live.attach(room)
    emit('dispatch', dispatchPayload())
    room = await startInitialStage({
      store,
      live,
      room,
      plan,
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
