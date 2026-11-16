import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { created, fail } from '../../result.js'
import { effectiveAcceptanceOf, normalizePlan, normalizeRequest, resolveMembers } from './input.js'
import { buildRoomRecord, initialRoomMessages } from './record.js'
import { createProvisioner } from './provision.js'
import { bodyIssueText } from '../../body-check.js'
import { plainRuntimeError } from '../../base-error.js'
import { prepareWorkspace, resolveWorkspaceProvider } from './workspace.js'
import { roomModeForType } from '../kinds.js'
import { gateRecordOf } from '../../gate/index.js'
import { transferOf } from '../../../../shared/transfer.js'
import { uniqueRoomShort } from './short-id.js'

const deliveryTitleFor = (goalTitle, handoff) => {
  if (handoff === null || handoff === undefined) return goalTitle
  const topic = String(handoff.topic ?? '').trim()
  const target = /[写存落交放](?:入|进|到)\s*([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/.exec(topic)
  if (target !== null) return `写入 ${target[1]}`
  if (topic === '') return '完成交接单'
  return topic.length <= 24 ? `完成${topic}` : '完成交接单'
}

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
  const gate = mode.evaluateGate({ handoff, humanReviewed: handoffReviewed })
  if (gate.decision === 'reject') {
    const issues = gate.issues.map(issue => issue.text).join('；')
    return fail('invalid', `还不能开工：${issues}`)
  }
  const membersResult = resolveMembers(body, roomType)
  if (membersResult.error !== undefined) return fail('invalid', membersResult.error)
  let { templateId, roster, workers, verifiers, worker, lead, align } = membersResult
  // A confirmed handoff already did the alignment at the Gate; do not ask for it
  // again inside the studio.
  const initialAlign = align && (handoff === null || handoff === undefined)
  if (typeof mode.validateRoster === 'function') {
    try {
      mode.validateRoster(roster, { verify })
    } catch (error) {
      return fail('invalid', `成员组合不可用：${error?.message ?? error}`)
    }
  }
  const resolvedPlan = mode.resolvePlan(plan, roster)
  for (const member of roster) {
    if (member.mcp.length > 0 && capabilities.mcp !== true) {
      return fail('conflict', '当前版本还不支持外部工具')
    }
  }
  const wantsSkills = roster.some(member => (member.skills ?? []).length > 0)
  if (wantsSkills && typeof engine.features === 'function') {
    const features = await engine.features()
    if (features?.skillsLibrary !== true) {
      return fail('conflict', '基座的技能库还没打开；先在基座设置里打开技能库，或去掉成员技能')
    }
  }

  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  const probeShort = randomUUID().slice(0, 8)
  const probeRepo = requestedRepo === '' ? join(ports.workspace.root(), `room-${probeShort}`) : resolve(requestedRepo)
  const providerResult = resolveWorkspaceProvider({ body, workspace, requestedRepo, sourceRepo: probeRepo, workspacePort: ports.workspace })
  if (providerResult.error !== undefined) return fail('invalid', providerResult.error)
  const provider = providerResult.provider
  // 短 id 同时是工作区目录和分支名；撞上残留目录时换一个，而不是复用别人的工作区。
  const short = uniqueRoomShort({ store, workspace: ports.workspace, provider })
  const sourceRepo = requestedRepo === '' ? join(ports.workspace.root(), `room-${short}`) : resolve(requestedRepo)
  const workspaceCaps = provider.capabilities()
  if (workspaceCaps.isolation === 'direct') {
    // 原地修改没有验收副本；验收员只读，避免 exec 改到用户目录。
    roster = roster.map(member => (
      member.role === 'verifier' || member.roleKind === 'verifier'
        ? { ...member, permissions: { ...member.permissions, exec: false, write: false }, toolSurface: ['read'] }
        : member
    ))
    verifiers = roster.filter(member => member.role === 'verifier')
  }
  if (roomType.readOnly !== true && workers.length > 1 && workspaceCaps.merge !== true) {
    return fail('conflict', '当前工作区不支持并行合并；先只保留一个执行成员')
  }
  let workspaces = null

  const roomId = `room-${short}`
  const provisioner = createProvisioner({ engine })
  let room = null
  let stored = false
  // 建房失败或政策拒绝时，把已经建出来的成员、基座房间和工作区一起收回。
  const discard = async () => {
    await provisioner.cleanup()
    try {
      if (workspaces !== null) provider.cleanupRoom({ source: sourceRepo, workspaces })
    } catch {}
    if (requestedRepo === '') {
      try { ports.workspace.remove(sourceRepo) } catch {}
    }
  }
  try {
    workspaces = prepareWorkspace({ provider, sourceRepo, short, roster, workspacePort: ports.workspace })
    const goalTitle = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
    const deliveryTitle = deliveryTitleFor(goalTitle, handoff)
    const title = name === '' ? goalTitle : name
    const provisioned = await provisioner.provision({
      roster,
      short,
      title,
      goal,
      handoff,
      verify,
      acceptance: effectiveAcceptance,
      align: initialAlign,
      workspaces,
      verifiers,
      roomType: roomType.id,
    })
    // 身体体检：没装好或没登录的模型在开工前就拦下，不把失败留到第一回合。
    const bodyIssues = (provisioned.bodyIssues ?? []).filter(item => item.issue !== '')
    if (bodyIssues.length > 0) {
      await discard()
      return fail('invalid', `身体没准备好：${bodyIssueText(bodyIssues)}`)
    }
    // 外部动作只有在驱动会停下来问人时才安全；不会问的执行成员不能开工。
    const blocked = roomType.readOnly === true
      ? []
      : provisioned.members.filter(member => (
        member.permissions?.exec === true && provisioned.approvalGates?.[member.id] === false
      ))
    if (blocked.length > 0) {
      await discard()
      return fail(
        'invalid',
        `${blocked.map(member => member.name).join('、')}用的模型不会逐次确认外部动作；换一个会先问你的模型，或把这件事放进聊天室讨论。`,
      )
    }
    const builtStages = roomType.buildStages({ title: deliveryTitle, plan: resolvedPlan, verify, acceptance, align: initialAlign })
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
      engineFallbacks: provisioned.engineFallbacks,
      members: provisioned.members,
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
      shadowReview,
        builtStages,
      roster,
      align: initialAlign,
      verify,
      acceptance,
      chatTurnLimit,
        parentRoomId: parentRoom?.id ?? null,
      depth: parentRoom === null ? 0 : (parentRoom.depth ?? 0) + 1,
      gate: gateRecordOf({
        review: gate,
        humanReviewed: handoffReviewed,
        check: { mode: verify, acceptance: effectiveAcceptance },
      }),
    })
    if (shadowReview && ports.advisor?.available === true) {
      room.advisorConsent = {
        host: ports.advisor.describe?.().host ?? '',
        at: Date.now(),
      }
    }
    store.writeRoom(room)
    stored = true
    if (parentRoom !== null) {
      const linked = store.updateRoom(parentRoom.id, current => {
        current.childRoomIds = [...new Set([...(current.childRoomIds ?? []), room.id])]
        return { events: [{ type: 'room.subroom.created', payload: { childRoomId: room.id } }] }
      })
      if (linked !== null) emit('room', linked)
    }
    store.appendEvent(room.id, 'room.created', { live: true, templateId, members: room.members, sourceRepo, branch: room.branch })
    ports.roomFiles.writeGoal(room)
    for (const message of initialRoomMessages({
      room,
      plan: resolvedPlan,
      templateId,
      roster,
      builtStages,
      workspaces,
      engineFallbacks: provisioned.engineFallbacks,
      approvalGates: provisioned.approvalGates,
    })) {
      store.appendMessage(room.id, message)
    }
    await live.attach(room, { resume: false })
    room = await mode.start({
      store,
      live,
      room,
      plan: resolvedPlan,
      align: initialAlign,
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
      await discard()
      throw new Error(`房间没能建起来：${plainRuntimeError(error)}`)
    }
    store.appendMessage(room.id, { kind: 'system', text: `房间建好了，但没能启动：${plainRuntimeError(error)}` })
    return created({ room, warning: plainRuntimeError(error) })
  }
}
