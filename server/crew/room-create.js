import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { workspaceRoot } from './paths.js'
import { created, fail } from './result.js'
import { writeBrief, writeGoal } from './room-repo.js'
import { DEFAULT_TEMPLATE_ID, roleSeats, rosterFromRoles, seatsFor, TEMPLATES, validateRoster } from './seats.js'
import { markSeatRead } from './watermarks.js'
import { cleanupWorkspaces, prepareWorkspaces } from './worktrees.js'

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

// 模板驱动建房：模板只是起点；roster 可以按需组合角色，每个席位一个基座线程与工作区。
export const createRealRoom = async ({ store, engine, live, emit, dispatchPayload, body }) => {
  const goal = typeof body.goal === 'string' ? body.goal.trim() : ''
  if (goal === '' || goal.length > 2000) return fail('invalid', '目标不能为空，且不超过 2000 字')
  const verify = body.verify === 'manual' ? 'manual' : 'test'
  const acceptance = typeof body.acceptance === 'string' ? body.acceptance.trim() : ''
  if (verify === 'test' && acceptance === '') return fail('invalid', '交付型房间需要一条验收命令')
  if (engine.capabilities().provisioning !== true) return fail('conflict', '当前 runtime 不支持从界面建房')

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
  const sourceRepo = requestedRepo === '' ? join(workspaceRoot(), `room-${short}`) : resolve(requestedRepo)
  let workspaces = null
  try {
    workspaces = prepareWorkspaces({ sourceRepo, short, seats: roster })
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

  const createdBots = []
  const createdGroups = []
  let room = null
  let stored = false
  try {
    for (const seat of roster) {
      const bot = await engine.createSeatBot({
        name: `${seat.id[0].toUpperCase()}${seat.id.slice(1)}${short}`,
        soul: seat.prompt,
        description: seat.station,
        approval: seat.approval,
        mcp: seat.mcp,
      })
      createdBots.push({ seat, bot })
    }
    const title = goal.length > 24 ? `${goal.slice(0, 24)}…` : goal
    const groupFor = async (seat, bot) => {
      const group = await engine.createRoom({
        name: `${title} · ${seat.name}`,
        goal,
        bulletin: roomBulletin(goal, verify, acceptance, align),
        members: [bot.id],
        cwd: workspaces.seats[seat.id].path,
        leadId: bot.id,
      })
      createdGroups.push(group)
      return group
    }
    const seatRooms = {}
    const seatBots = {}
    const seatNames = {}
    const engines = {}
    for (const { seat, bot } of createdBots) {
      const group = await groupFor(seat, bot)
      seatRooms[seat.id] = { id: group.id, sessionRef: group.sessionRef }
      seatBots[seat.id] = bot.id
      seatNames[seat.id] = bot.name
      engines[seat.id] = bot.engine
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
      repoPath: workspaces.roomPath ?? workspaces.seats[worker.id].path,
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
      ],
      usage: { costMicroUsd: 0, budgetMicroUsd: 0, turns: 0 },
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
    await live.attach(room)
    emit('dispatch', dispatchPayload())
    if (plan !== null) {
      await live.startStage(room, 0)
    } else if (!align && workers.length > 1) {
      await live.startStage(room, 0)
    } else {
      const targetSeat = align ? lead : worker
      markSeatRead({ store, roomId: room.id, seat: targetSeat.id, emit })
      const sent = await live.sendToSeat(
        room.id,
        targetSeat.id,
        align ? alignmentPrompt(targetSeat.name, goal, verify, acceptance) : directPrompt(goal, verify, acceptance, roster.length === 1),
      )
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
      for (const group of createdGroups) await engine.deleteRoom(group.id)
      for (const item of createdBots) await engine.deleteSeatBot(item.bot.id)
      cleanupWorkspaces({ sourceRepo, workspaces })
      throw new Error(`建房失败：${error?.message ?? error}`)
    }
    store.appendMessage(room.id, { kind: 'system', text: `房间已建，但启动失败：${error?.message ?? error}` })
    return created({ room, warning: String(error?.message ?? error) })
  }
}

const roleLabel = seat => seat.name
