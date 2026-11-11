import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { budgetHint, globalBudgetStatus, roomBudgetFromBody } from './budget.js'
import { workspaceRoot } from './paths.js'
import { created, fail } from './result.js'
import { readBrief, writeBrief, writeGoal } from './room-repo.js'
import { buildSeatHandoff } from './seat-handoff.js'
import { DEFAULT_TEMPLATE_ID, roleSeats, rosterFromRoles, seatsFor, TEMPLATES, validateRoster } from './seats.js'
import { markSeatRead } from './watermarks.js'
import { defaultWorkspace, workspaceById } from './workspace.js'
import { MAX_PROJECT_BYTES, PROJECT_FILE, readProjectConstraints } from './project.js'

const roomBulletin = (goal, verify, acceptance, align) => [
  `目标：${goal}`,
  verify === 'test' ? `验收：${acceptance}` : '验收：人确认，不跑命令',
  align
    ? `阶段：1 目标对齐（人确认）；2 ${verify === 'test' ? '交付（命令验收）' : '确认（人签字）'}`
    : `阶段：1 ${verify === 'test' ? '交付（命令验收）' : '确认（人签字）'}`,
].join('\n')

const alignmentPrompt = (leadName, goal, verify, acceptance) => [
  `@${leadName} 目标：${goal}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  '先和人对齐：只问真正要人拍板的问题（最多 3 个），每个附推荐答案；不要改代码，不要 @工作席位。',
  '用户确认阶段后，系统会发一条以「阶段已确认」开头的消息；收到之前不要派活。',
].join('\n')

const directPrompt = (goal, verify, acceptance, singleSeat) => [
  `目标：${goal}`,
  verify === 'test' ? `验收命令：\`${acceptance}\`` : '验收方式：人确认，不跑命令',
  singleSeat
    ? '这是单人房间：直接在当前工作区完成，不要问问题，不要等人对齐；完成后一句话汇报。'
    : '这个房间没有单独的队长：直接在当前工作区完成，不要问问题，不要等人对齐；完成后一句话汇报。',
  '不要自己 git commit / push，系统会提交候选。',
].join('\n')

// 续做只继承人写的 BRIEF；旧证据、阶段与席位会话都不复制。
export const inheritedPlan = (brief, sourceName) => {
  const done = (brief?.done ?? [])
    .map(item => item.text)
    .filter(text => typeof text === 'string' && text.trim() !== '')
    .map(text => text.trim().slice(0, 200))
    .slice(0, 6)
  if (done.length === 0) return null
  return { done, answers: [], why: `续做自交接记录「${sourceName}」` }
}

// 模板驱动建房：模板只是起点；roster 可以按需组合角色，每个席位一个基座线程与工作区。
export const createRealRoom = async ({ store, engine, live, emit, dispatchPayload, body, workspace = null }) => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return fail('invalid', '目标不能为空，且不超过 2000 字')
  const verify = body.verify === 'manual' ? 'manual' : 'test'
  const acceptance = typeof body.acceptance === 'string' ? body.acceptance.trim() : ''
  if (verify === 'test' && acceptance === '') return fail('invalid', '交付型房间需要一条验收命令')
  let continueSource = null
  if (typeof body.continueFrom === 'string' && body.continueFrom !== '') {
    continueSource = store.readRoom(body.continueFrom)
    if (continueSource === null || continueSource.kind !== 'room') return fail('not_found', '没有这个交接记录')
    if (continueSource.imported !== true) return fail('conflict', '只有导入的交接记录可以作为续做起点')
  }
  if (engine.capabilities().provisioning !== true) return fail('conflict', '当前 runtime 不支持从界面建房')
  const globalBudget = globalBudgetStatus(store.readRooms())
  if (!globalBudget.ok) return fail('conflict', `${globalBudget.message}；${budgetHint(globalBudget)}`)
  const budgetMicroUsd = roomBudgetFromBody(body)

  let plan = null
  if (body.plan !== undefined && body.plan !== null) {
    const done = Array.isArray(body.plan.done)
      ? body.plan.done
        .filter(item => typeof item === 'string' && item.trim() !== '')
        .map(item => item.trim().slice(0, 200))
        .slice(0, 6)
      : []
    if (done.length === 0) return fail('invalid', '开工卡缺少可核对的 done')
    const answers = Array.isArray(body.plan.answers)
      ? body.plan.answers
        .filter(item => typeof item?.question === 'string' && item.question.trim() !== '' && typeof item?.answer === 'string')
        .map(item => ({ question: item.question.trim().slice(0, 300), answer: item.answer.trim().slice(0, 300) }))
        .slice(0, 3)
      : []
    plan = {
      done,
      answers,
      why: typeof body.plan.why === 'string' ? body.plan.why.trim().slice(0, 300) : '',
    }
  } else if (continueSource !== null) {
    plan = inheritedPlan(readBrief(continueSource), continueSource.name)
  }

  const requestedSeats = Array.isArray(body.seats) ? body.seats : null
  let templateId = typeof body.templateId === 'string' && TEMPLATES[body.templateId]?.seats.length > 0
    ? body.templateId
    : DEFAULT_TEMPLATE_ID
  let roster
  try {
    if (requestedSeats !== null && requestedSeats.length > 0) {
      templateId = 'custom'
      roster = rosterFromRoles(requestedSeats)
    } else {
      roster = seatsFor(templateId)
    }
    validateRoster(roster)
  } catch (error) {
    return fail('invalid', `席位组合不可用：${error?.message ?? error}`)
  }
  const { workers, verifiers } = roleSeats(roster)
  const worker = workers[0]
  const explicitLead = roster.find(seat => seat.role === 'lead')
  const lead = explicitLead ?? worker
  const align = explicitLead !== undefined
  if (verifiers.length > 1) return fail('invalid', '多验收席位尚未接入：目前一个房间最多一个验收席位')
  if (verify === 'manual' && verifiers.length > 0) {
    return fail('invalid', '人工验收模式不需要验收席位；要独立复核就补一条验收命令')
  }

  const short = randomUUID().slice(0, 6)
  const requestedRepo = typeof body.repoPath === 'string' ? body.repoPath.trim() : ''
  if (continueSource !== null && requestedRepo === '') {
    return fail('invalid', '续做要指定上一轮交付所在的本地仓库或目录；交接包本身不含代码')
  }
  const sourceRepo = requestedRepo === '' ? join(workspaceRoot(), `room-${short}`) : resolve(requestedRepo)
  const explicitWorkspace = typeof body.workspaceProvider === 'string' ? body.workspaceProvider.trim() : ''
  let provider = workspace
  if (provider === null) {
    if (explicitWorkspace !== '') {
      provider = workspaceById(explicitWorkspace)
      if (provider === undefined) return fail('invalid', '未知的工作区类型')
    } else if (requestedRepo === '') {
      provider = defaultWorkspace
    } else {
      const gitProbe = defaultWorkspace.probeSource({ source: sourceRepo })
      const plainProbe = workspaceById('plain').probeSource({ source: sourceRepo })
      provider = gitProbe.ok ? defaultWorkspace : plainProbe.ok ? workspaceById('plain') : defaultWorkspace
    }
  }
  if (provider === undefined) return fail('invalid', '未知的工作区类型')
  if (requestedRepo !== '' && provider.id === 'plain') {
    const probe = provider.probeSource({ source: sourceRepo })
    if (!probe.ok) return fail('invalid', probe.error)
  }
  const workspaceCaps = provider.capabilities()
  if (workers.length > 1 && workspaceCaps.merge !== true) {
    return fail('conflict', '当前工作区不支持并行合并；先只保留一个执行席位')
  }
  const explicitProject = typeof body.projectConstraints === 'string'
    ? body.projectConstraints.trim().slice(0, MAX_PROJECT_BYTES)
    : ''
  const projectFile = explicitProject === '' && body.includeProjectConstraints === true
    ? readProjectConstraints(sourceRepo)
    : null
  const projectContent = explicitProject !== '' ? explicitProject : projectFile?.content?.trim() ?? ''
  let workspaces = null
  try {
    workspaces = provider.prepareRoom({ source: sourceRepo, short, seats: roster })
  } catch (error) {
    // git / 磁盘 / 权限问题不是用户的业务拒绝；交给组合根显式 500。
    throw new Error(`工作区不可用：${error?.message ?? error}`)
  }

  const capabilities = engine.capabilities()
  for (const seat of roster) {
    if (seat.skills.length > 0 && capabilities.skills !== true) {
      return fail('conflict', '当前 runtime 还不能安装技能；先不要给席位声明技能')
    }
    if (seat.mcp.length > 0 && capabilities.mcp !== true) {
      return fail('conflict', '当前 runtime 不支持 MCP')
    }
  }

  const createdSeatRefs = []
  const createdBaseRooms = []
  let room = null
  let stored = false
  try {
    for (const seat of roster) {
      const seatRef = await engine.createSeatBot({
        name: `${seat.id[0].toUpperCase()}${seat.id.slice(1)}${short}`,
        soul: seat.prompt,
        description: seat.station,
        approval: seat.approval,
        mcp: seat.mcp,
        engine: seat.engine,
      })
      createdSeatRefs.push({ seat, seatRef })
    }
    const engineFallbacks = Object.fromEntries(createdSeatRefs
      .filter(({ seatRef }) => seatRef.fallback === true)
      .map(({ seat, seatRef }) => [seat.id, { requested: seatRef.requestedEngine, actual: seatRef.engine, reason: seatRef.reason }]))
    const title = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
    const baseRoomFor = async (seat, seatRef) => {
      const baseRoom = await engine.createRoom({
        name: `${title} · ${seat.name}`,
        goal,
        bulletin: roomBulletin(goal, verify, acceptance, align),
        members: [seatRef.id],
        cwd: workspaces.seats[seat.id].path,
        leadId: seatRef.id,
      })
      createdBaseRooms.push(baseRoom)
      return baseRoom
    }
    const seatRooms = {}
    const seatBots = {}
    const seatNames = {}
    const engines = {}
    for (const { seat, seatRef } of createdSeatRefs) {
      const baseRoom = await baseRoomFor(seat, seatRef)
      seatRooms[seat.id] = { id: baseRoom.id, sessionRef: baseRoom.sessionRef }
      seatBots[seat.id] = seatRef.id
      seatNames[seat.id] = seatRef.name
      engines[seat.id] = seatRef.engine
    }
    const worktrees = Object.fromEntries(Object.entries(workspaces.seats).map(([seatId, item]) => [seatId, item.path]))

    room = {
      id: `room-${short}`,
      kind: 'room',
      name: title,
      goal,
      templateId,
      plan,
      independence: verifiers.length === 0 ? (roster.length === 1 ? 'solo' : 'human') : 'none',
      engines,
      engineFallbacks,
      seatBots,
      seatNames,
      seatRooms,
      leadSeat: lead.id,
      workers: workers.map(seat => seat.id),
      verifiers: verifiers.map(seat => seat.id),
      sourceRepo,
      branch: workspaces.primaryBranch,
      branches: workspaces.branches,
      worktrees,
      ports: workspaces.ports ?? {},
      workspaceEnv: workspaces.environment ?? {},
      repoPath: workspaces.roomPath ?? workspaces.seats[worker.id].path,
      workspace: { provider: provider.id, capabilities: workspaceCaps },
      ...(continueSource === null
        ? {}
        : { continuedFrom: { roomId: continueSource.id, name: continueSource.name } }),
      live: true,
      demo: false,
      state: 'active',
      idle: false,
      round: 0,
      noProgress: 0,
      seatCursors: Object.fromEntries(roster.map(seat => [seat.id, 0])),
      openQuestion: null,
      version: 1,
      seatSpecs: roster.map(({ id, name, title: seatTitle, role, station, permissions, writeScope, toolSurface, skills, mcp, approval, speakBudget }) => ({
        id, name, title: seatTitle, role, station, permissions, writeScope, toolSurface, skills, mcp, approval, speakBudget,
      })),
      constraints: [
        verify === 'test' ? `验收命令：${acceptance}` : '验收方式：人确认，不跑命令',
        align
          ? `${roleLabel(lead)} 只读/规划；${workers.map(roleLabel).join('、')} 在自己的 worktree${verifiers.length > 0 ? `；${verifiers.map(roleLabel).join('、')} 在一次性副本` : ''}`
          : `${workers.map(roleLabel).join('、')} 在自己的 worktree`,
        ...(verifiers.length === 0
          ? [`${roster.length === 1 ? '单人模板' : '这个房间'}没有独立验收席位，由你凭证据签字`]
          : ['当前只有一台 CLI：席位同引擎，验收卡会标「独立性降级」']),
        ...(workers.length > 1
          ? [`${workers.length} 个执行席位并行，各自 worktree；系统把候选分支合并到房间分支 ${workspaces.primaryBranch}，冲突时停下等你`]
          : []),
        ...(continueSource === null ? [] : [`续做自交接记录「${continueSource.name}」；上一轮记录保持只读`]),
      ],
      usage: { costMicroUsd: 0, budgetMicroUsd, turns: 0 },
      ...(projectContent === ''
        ? {}
        : {
            projectConstraints: {
              source: projectFile?.layers?.[0]?.name ?? PROJECT_FILE,
              content: projectContent,
              layers: projectFile?.layers ?? [],
            },
          }),
      members: roster.map(seat => seat.id),
      stages: plan !== null
        ? [verify === 'test'
            ? { title, kind: 'deliverable', state: 'active', acceptance }
            : { title, kind: 'decision', state: 'active', manual: true }]
        : align
          ? [
              { title: '目标对齐', kind: 'decision', state: 'active' },
              { title, kind: verify === 'test' ? 'deliverable' : 'decision', state: 'pending', ...(verify === 'test' ? { acceptance } : {}) },
            ]
          : [
              verify === 'test'
                ? { title, kind: 'deliverable', state: 'active', acceptance }
                : { title, kind: 'decision', state: 'active' },
            ],
    }
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
    store.appendMessage(room.id, {
      kind: 'system',
      text: plan !== null
        ? `房间已创建 · 开工卡已确认 · ${roster.length} 席各自工作区`
        : `房间已创建 · 模板 ${TEMPLATES[templateId].name} · ${roster.length} 席各自工作区`,
    })
    if (room.branch !== '') store.appendMessage(room.id, { kind: 'system', text: `源仓库 ${sourceRepo} · 执行分支 ${room.branch}` })
    if (continueSource !== null) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `续做自交接记录「${continueSource.name}」（${continueSource.id}）；旧记录不复活，只作为 BRIEF 与证据的出处。`,
      })
    }
    if (projectContent !== '') {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `已带入项目约束：${projectFile?.layers?.length ?? 1} 层（${projectContent.split('\n').filter(line => line.trim() !== '').length} 行，创建时快照）。`,
      })
    }
    const envWarnings = Object.entries(workspaces.environment ?? {})
      .flatMap(([seat, env]) => (env.warnings ?? []).map(text => `${seat}: ${text}`))
    if (envWarnings.length > 0) {
      store.appendMessage(room.id, { kind: 'system', text: `工作区环境同步警告：${envWarnings.join('；')}` })
    }
    const mcpSeats = roster.filter(seat => seat.mcp.length > 0)
    if (mcpSeats.length > 0) {
      store.appendMessage(room.id, {
        kind: 'system',
        text: `MCP 已开启：${mcpSeats.map(seat => `${seat.name}（${seat.mcp.map(grant => grant.server).join('、')}）`).join('；')}。调用写 events.jsonl；单个工具失败只影响当前席位回合，房间继续。`,
      })
    }
    if (Object.keys(engineFallbacks).length > 0) {
      const text = Object.entries(engineFallbacks)
        .map(([seat, item]) => `${seat} 请求 ${item.requested}，实际 ${item.actual}`)
        .join('；')
      store.appendMessage(room.id, {
        kind: 'system',
        text: `引擎降级：${text}。跨厂商独立性不成立，验收卡会按实际引擎标注。`,
      })
    }
    await live.attach(room)
    emit('dispatch', dispatchPayload())
    if (plan !== null) {
      await live.startStage(room, 0)
    } else if (!align && workers.length > 1) {
      await live.startStage(room, 0)
    } else {
      const targetSeat = align ? lead : worker
      markSeatRead({ store, roomId: room.id, seat: targetSeat.id, emit })
      const opening = align
        ? alignmentPrompt(targetSeat.name, goal, verify, acceptance)
        : directPrompt(goal, verify, acceptance, roster.length === 1)
      const context = buildSeatHandoff({ room, messages: store.readMessages(room.id), seat: targetSeat.id })
      const sent = await live.sendToSeat(room.id, targetSeat.id, `${opening}\n\n${context}`)
      if (sent.messageId !== null) {
        const updated = store.updateRoom(room.id, current => {
          current.hiddenBaseMessages = [...(current.hiddenBaseMessages ?? []), sent.messageId].slice(-50)
          return { events: [] }
        })
        if (updated !== null) room = updated
      }
    }
    room = store.readRoom(room.id) ?? room
    emit('room', room)
    return created({ room })
  } catch (error) {
    if (!stored) {
      for (const baseRoom of createdBaseRooms) await engine.deleteRoom(baseRoom.id)
      for (const item of createdSeatRefs) await engine.deleteSeatBot(item.seatRef.id)
      provider.cleanupRoom({ source: sourceRepo, workspaces })
      throw new Error(`建房失败：${error?.message ?? error}`)
    }
    store.appendMessage(room.id, { kind: 'system', text: `房间已建，但启动失败：${error?.message ?? error}` })
    return created({ room, warning: String(error?.message ?? error) })
  }
}

const roleLabel = seat => seat.name
