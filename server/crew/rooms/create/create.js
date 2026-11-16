import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { created, fail } from '../../result.js'
import { effectiveAcceptanceOf, normalizePlan, normalizeRequest, resolveSeats } from './input.js'
import { buildRoomRecord, initialRoomMessages } from './record.js'
import { createProvisioner } from './provision.js'
import { prepareWorkspace, resolveWorkspaceProvider } from './workspace.js'
import { roomModeForType } from '../kinds.js'
import { gateRecordOf } from '../../gate/index.js'
import { transferOf } from '../../../../shared/transfer.js'


// 模板驱动建房：模板只是起点；roster 可以按需组合角色，每个成员一个基座线程与工作区。
export const createRealRoom = async ({ store, engine, live, emit, body, workspace = null, ports, parentRoom = null }) => {
  const request = normalizeRequest(body)
  if (request.error !== undefined) return fail('invalid', request.error)
  const {
    goal,
    name,
    roomType,
    verify,
    acceptance,
    orchestration,
    shadowReview,
    chatTurnLimit,
    handoff,
    handoffReviewed,
    receipt,
    sourceRoomId,
    sourceName,
  } = request
  const mode = roomModeForType(roomType.id)
  const capabilities = engine.capabilities()
  if (capabilities.provisioning !== true) return fail('conflict', '当前版本还不支持从界面建房')
  if (capabilities.mentions !== true) return fail('conflict', '当前版本还不支持 @ 唤醒，无法建房')

  const { plan, error: planError } = normalizePlan({ body })
  if (planError !== undefined) return fail('invalid', planError)
  const effectiveAcceptance = effectiveAcceptanceOf(acceptance, plan)
  const advisor = mode.requiresGate
    ? await ports.advisor?.advice?.({
      mode: 'gate',
      goal,
      roomType: roomType.id,
      plan,
      verify,
      acceptance: effectiveAcceptance,
    }) ?? { available: false, advice: [] }
    : { available: false, advice: [] }
  const gate = mode.evaluateGate({ handoff, humanReviewed: handoffReviewed, advice: advisor.advice })
  if (gate.decision === 'reject') {
    const advice = (Array.isArray(gate.advice) ? gate.advice : [])
      .map(item => item?.summary ?? [...(item?.reasons ?? []), ...(item?.risks ?? [])].join('；'))
      .filter(Boolean)
      .join('；')
    const issues = gate.issues.map(issue => issue.text).join('；')
    return fail('invalid', `还不能开工：${issues}${advice === '' ? '' : `；建议：${advice}`}`)
  }
  const seatsResult = resolveSeats(body, roomType)
  if (seatsResult.error !== undefined) return fail('invalid', seatsResult.error)
  const { templateId, roster, workers, verifiers, worker, lead, align } = seatsResult
  if (typeof mode.validateRoster === 'function') {
    try {
      mode.validateRoster(roster, { verify })
    } catch (error) {
      return fail('invalid', `成员组合不可用：${error?.message ?? error}`)
    }
  }
  const resolvedPlan = mode.resolvePlan(plan, roster)
  for (const seat of roster) {
    const missingSkills = seat.skills.filter(id => ports.skills?.has?.(id) !== true)
    if (missingSkills.length > 0) {
      return fail('invalid', `这些技能还没准备好：${missingSkills.join('、')}；先放入 templates/skills`)
    }
    if (seat.mcp.length > 0 && capabilities.mcp !== true) {
      return fail('conflict', '当前版本还不支持外部工具')
    }
  }

  const short = randomUUID().slice(0, 6)
  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  const sourceRepo = requestedRepo === '' ? join(ports.workspace.root(), `room-${short}`) : resolve(requestedRepo)
  const providerResult = resolveWorkspaceProvider({ body, workspace, requestedRepo, sourceRepo, workspacePort: ports.workspace })
  if (providerResult.error !== undefined) return fail('invalid', providerResult.error)
  const provider = providerResult.provider
  const workspaceCaps = provider.capabilities()
  if (roomType.readOnly !== true && workers.length > 1 && workspaceCaps.merge !== true) {
    return fail('conflict', '当前工作区不支持并行合并；先只保留一个执行成员')
  }
  const workspaces = prepareWorkspace({ provider, sourceRepo, short, roster, workspacePort: ports.workspace })

  const roomId = `room-${short}`
  const provisioner = createProvisioner({ engine })
  let room = null
  let stored = false
  try {
    const goalTitle = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
    // A handoff topic is a sentence, not a step name. Keep the sentence in the
    // handoff card and give the default delivery stage a short, honest title.
    const deliveryTitle = handoff !== null && handoff !== undefined && handoff.topic.length > 24
      ? '完成交接单'
      : goalTitle
    const title = name === '' ? goalTitle : name
    const provisioned = await provisioner.provision({
      roster,
      short,
      title,
      goal,
      handoff,
      verify,
      acceptance: effectiveAcceptance,
      align,
      workspaces,
      verifiers,
      roomType: roomType.id,
    })
    const builtStages = roomType.buildStages({ title: deliveryTitle, plan: resolvedPlan, verify, acceptance, align })
    room = buildRoomRecord({
      short,
      title,
      goal,
      handoff,
      receipt,
      transfer: transferOf({ handoff, receipt, fromRoomId: sourceRoomId, fromRoomName: sourceName }),
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
      chatHost: provisioned.chatHost,
      lead,
      workers,
      verifiers,
      sourceRepo,
      workspaces,
      provider,
      workspaceCaps,
      roomType,
      orchestration: orchestration.id,
      builtStages,
      roster,
      align,
      verify,
      acceptance,
      chatTurnLimit,
      shadowReview,
      parentRoomId: parentRoom?.id ?? null,
      depth: parentRoom === null ? 0 : (parentRoom.depth ?? 0) + 1,
      gate: gateRecordOf({
        review: gate,
        humanReviewed: handoffReviewed,
        advisor,
        check: { mode: verify, acceptance: effectiveAcceptance },
      }),
    })
    store.writeRoom(room)
    stored = true
    if (parentRoom !== null) {
      const linked = store.updateRoom(parentRoom.id, current => {
        current.childRoomIds = [...new Set([...(current.childRoomIds ?? []), room.id])]
        return { events: [{ type: 'room.subroom.created', payload: { childRoomId: room.id } }] }
      })
      if (linked !== null) emit('room', linked)
    }
    store.appendEvent(room.id, 'room.created', { live: true, templateId, seats: room.members, sourceRepo, branch: room.branch })
    ports.roomFiles.writeBrief(room, resolvedPlan)
    ports.roomFiles.writeGoal(room)
    for (const message of initialRoomMessages({
      room,
      plan: resolvedPlan,
      templateId,
      roster,
      builtStages,
      workspaces,
      engineFallbacks: provisioned.engineFallbacks,
    })) {
      store.appendMessage(room.id, message)
    }
    await live.attach(room, { resume: false })
    room = await mode.start({
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
      acceptance: effectiveAcceptance,
      emit,
    })
    room = store.readRoom(room.id) ?? room
    emit('room', room)
    return created({ room })
  } catch (error) {
    if (!stored) {
      await provisioner.cleanup()
      provider.cleanupRoom({ source: sourceRepo, workspaces })
      throw new Error(`房间没能建起来：${error?.message ?? error}`)
    }
    store.appendMessage(room.id, { kind: 'system', text: `房间建好了，但没能启动：${error?.message ?? error}` })
    return created({ room, warning: String(error?.message ?? error) })
  }
}
