import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { created, fail } from '../../result.js'
import { effectiveAcceptanceOf, normalizePlan, normalizeRequest, resolveMembers } from './input.js'
import { buildRoomRecord, initialRoomMessages } from './record.js'
import { createProvisioner } from './provision.js'
import { bodyIssueText } from '../../body-check.js'
import { plainRuntimeError } from '../../base-error.js'
import { ROUND_STATUS } from '../../../../shared/states.js'
import { prepareWorkspace, resolveWorkspaceProvider } from './workspace.js'
import { roomModeForType } from '../kinds.js'
import { gateRecordOf } from '../../gate/index.js'
import { transferOf } from '../../../../shared/transfer.js'
import { grantBrowserToAll, needsBrowser, stripBrowser } from '../../room-access.js'
import { uniqueRoomShort } from './short-id.js'
import { buildRoundFromRoom, composeRoundView, shortTitleOf, studioFromRoom } from '../../rounds/record.js'

const deliveryTitleFor = (goalTitle, handoff) => {
  if (handoff === null || handoff === undefined) return goalTitle
  const topic = String(handoff.topic ?? '').trim()
  const target = /[写存落交放](?:入|进|到)\s*([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)/.exec(topic)
  if (target !== null) return `写入 ${target[1]}`
  // 步骤名就是这一步要做的事；交接单再长也要说清是哪件事，不能缩成“完成交接单”。
  if (topic === '') return goalTitle
  return topic.length <= 24 ? topic : `${topic.slice(0, 24)}…`
}

// 模板驱动建房：模板只是起点；roster 可以按需组合角色，每个成员一个基座线程与工作区。
export const createRealRoom = async ({ store, engine, live, emit, body, workspace = null, ports }) => {
  const request = normalizeRequest(body)
  if (request.error !== undefined) return fail('invalid', request.error)
  const {
    goal,
    name,
    roomType,
    project,
    verify,
    acceptance,
    orchestration,
    shadowReview,
    autoDeliver,
    chatTurnLimit,
    handoff,
    handoffReviewed,
    receipt,
    sourceRoomId,
    sourceName,
    bootstrap,
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
  const membersResult = resolveMembers(body, roomType, { bootstrap })
  if (membersResult.error !== undefined) return fail('invalid', membersResult.error)
  let { templateId, roster, workers, verifiers, worker, lead, align } = membersResult
  // A confirmed handoff already did the alignment at the Gate; do not ask for it
  // again inside the studio.
  const initialAlign = align && (handoff === null || handoff === undefined)
  if (typeof mode.validateRoster === 'function') {
    try {
      mode.validateRoster(roster, { verify, bootstrap })
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
  if (wantsSkills && ports.roleSkills?.ready?.() === false) {
    return fail('conflict', '角色技能还没有准备好；先检查 Lodge 服务的技能库，或稍后重启 Lodge')
  }
  if (wantsSkills && typeof engine.features === 'function') {
    const features = await engine.features()
    if (features?.skillsLibrary !== true) {
      return fail('conflict', 'Lodge 服务的技能库还没打开；先打开技能库，或去掉成员技能')
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
  if (roomType.readOnly === true) {
    // 聊天室只读：成员只讨论，不执行工具、不改文件。
    roster = roster.map(member => ({
      ...member,
      permissions: { read: true, exec: false, write: false },
      toolSurface: ['read'],
      writeScope: 'none',
    }))
  }
  if (roomType.readOnly !== true && workers.length > 1 && workspaceCaps.merge !== true) {
    return fail('conflict', '当前工作区不支持并行合并；先只保留一个执行官')
  }
  roster = grantBrowserToAll(roster)
  let browserReady = true
  if (needsBrowser(roster) && ports.browserMcp !== null && ports.browserMcp !== undefined) {
    browserReady = (await ports.browserMcp.ensure?.()) === true
    if (!browserReady) roster = stripBrowser(roster)
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
    const goalTitle = shortTitleOf(goal)
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
      shadowReview,
    })
    // 身体体检：没装好或没登录的模型在开工前就拦下，不把失败留到第一回合。
    const bodyIssues = (provisioned.bodyIssues ?? []).filter(item => item.issue !== '')
    if (bodyIssues.length > 0) {
      await discard()
      return fail('invalid', `成员还没准备好：${bodyIssueText(bodyIssues)}`)
    }
    // 不会逐次确认外部动作的验收员只读参与：它看证据、给结论，命令由平台在副本里跑。
    const readOnlyVerifierIds = new Set(
      provisioned.members
        .filter(member => (
          (member.roleKind ?? member.role) === 'verifier' &&
          provisioned.approvalGates?.[member.id] === false
        ))
        .map(member => member.id),
    )
    const members = provisioned.members.map(member => (
      readOnlyVerifierIds.has(member.id)
        ? {
          ...member,
          permissions: { read: true, exec: false, write: false },
          toolSurface: ['read'],
          writeScope: 'none',
        }
        : member
    ))
    // 外部动作只有在驱动会停下来问人时才安全；不会问的执行官不能开工。
    // 聊天室虽然只读，但读文件和只读公网也要经过同一张确认卡。
    const blocked = members.filter(member => (
      provisioned.approvalGates?.[member.id] === false &&
      (roomType.readOnly === true || member.permissions?.exec === true)
    ))
    if (blocked.length > 0) {
      await discard()
      return fail(
        'invalid',
        roomType.readOnly === true
          ? `${blocked.map(member => member.name).join('、')}用的模型不会先问你；聊天室要读文件或联网，换一个会先问你的模型。`
          : `${blocked.map(member => member.name).join('、')}用的模型不会逐次确认外部动作；换一个会先问你的模型，或把这件事放进聊天室讨论。`,
      )
    }
    const builtStages = roomType.buildStages({ title: deliveryTitle, plan: resolvedPlan, verify, acceptance, align: initialAlign, bootstrap })
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
      members,
      chatRoom: provisioned.chatRoom,
      chatHost: provisioned.chatHost,
      shadowBot: provisioned.shadowBot ?? null,
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
      autoDeliver,
      builtStages,
      align: initialAlign,
      verify,
      acceptance,
      chatTurnLimit,
      gate: gateRecordOf({
        review: gate,
        humanReviewed: handoffReviewed,
        check: { mode: verify, acceptance: effectiveAcceptance },
      }),
    })
    // 来源是聊天/回执/子房交接的事实；项目关系走 project 表，不再挂在房间上。
    if (typeof sourceRoomId === 'string' && sourceRoomId !== '') room = { ...room, sourceRoomId }
    if (typeof sourceName === 'string' && sourceName !== '') room = { ...room, sourceName }
    // 记住建房时的 HEAD：阶段起点万一没记下，验收和交付还有据可依。
    try {
      const startHead = typeof room.repoPath === 'string' && room.repoPath !== ''
        ? provider.head?.({ path: room.repoPath })
        : null
      if (typeof startHead === 'string' && startHead !== '') room = { ...room, startHead }
    } catch {}
    let sharedMemory = []
    try {
      sharedMemory = ports.memory?.shared?.({ sourceRepo, limit: 3 }) ?? []
    } catch {}
    if (sharedMemory.length > 0) room = { ...room, sharedMemory }
    const readOnlyNames = members.filter(member => readOnlyVerifierIds.has(member.id)).map(member => member.name)
    if (readOnlyNames.length > 0) {
      room = {
        ...room,
        constraints: [
          ...(room.constraints ?? []),
          `${readOnlyNames.join('、')}不会逐次确认外部动作，只读参与验收；验收命令由平台执行。`,
        ],
      }
    }
    let projectId = null
    if (project !== null && typeof project.northStar === 'string' && project.northStar !== '') {
      const createdProject = store.writeProject({
        id: `project-${short}`,
        name: project.northStar.slice(0, 60),
        northStar: project.northStar,
      })
      projectId = createdProject.id
    }
    const firstRound = buildRoundFromRoom({ room, projectId, ordinal: 1, status: ROUND_STATUS.active })
    const studio = studioFromRoom(room, firstRound)
    store.writeRoom(studio)
    store.writeWorkRound(firstRound)
    room = composeRoundView(studio, firstRound)
    stored = true
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
    if (!browserReady) {
      store.appendMessage(room.id, { kind: 'system', text: '浏览器没准备好，这间房的成员这次不查网页。' })
    }
    await live.attach(room, { resume: false })
    // 规划师要选模型，得先知道这台机器上有哪些 engine/model；只给可用的默认模型。
    const engines = typeof engine.instances === 'function' ? await engine.instances() : []
    room = await mode.start({
      engines,
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
