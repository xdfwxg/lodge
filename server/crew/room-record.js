import { TEMPLATES } from './seats.js'

const roleLabel = seat => seat.name

export const buildRoomRecord = ({
  short,
  title,
  goal,
  templateId,
  plan,
  independence,
  engines,
  models,
  engineFallbacks,
  seatBots,
  seatNames,
  seatRooms,
  chatRoom,
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
  projectPort,
  roomType,
  orchestration,
  builtStages,
  roster,
  align,
  verify,
  acceptance,
  verifierPolicy = 'all',
}) => ({
  id: `room-${short}`,
  kind: 'room',
  name: title,
  goal,
  templateId,
  plan,
  independence,
  engines,
  models,
  engineFallbacks,
  seatBots,
  seatNames,
  seatRooms,
  chatRoom,
  leadSeat: lead.id,
  workers: workers.map(seat => seat.id),
  verifiers: verifiers.map(seat => seat.id),
  sourceRepo,
  branch: workspaces.primaryBranch,
  branches: workspaces.branches,
  worktrees: Object.fromEntries(Object.entries(workspaces.seats).map(([seatId, item]) => [seatId, item.path])),
  ports: workspaces.ports ?? {},
  workspaceEnv: workspaces.environment ?? {},
  repoPath: workspaces.roomPath ?? workspaces.seats[workers[0]?.id ?? lead.id].path,
  workspace: { provider: provider.id, capabilities: workspaceCaps },
  ...(continueSource === null
    ? {}
    : { continuedFrom: { roomId: continueSource.id, name: continueSource.name } }),
  live: true,
  demo: false,
  state: 'active',
  trust: 'verify',
  idle: false,
  round: 0,
  noProgress: 0,
  seatCursors: Object.fromEntries(roster.map(seat => [seat.id, 0])),
  openQuestion: null,
  version: 1,
  seatSpecs: roster.map(({ id, name, title: seatTitle, role, roleKind, roleProfile, isHost, station, engine, model, permissions, writeScope, toolSurface, skills, mcp, approval, speakBudget }) => ({
    id,
    name,
    title: seatTitle,
    role,
    roleKind,
    roleProfile,
    ...(isHost === true ? { isHost: true } : {}),
    station,
    engine,
    ...(model === undefined ? {} : { model }),
    permissions,
    writeScope,
    toolSurface,
    skills,
    mcp,
    approval,
    speakBudget,
  })),
  constraints: roomType.id === 'chat'
    ? [
        '聊天室只读：成员只讨论，不执行工具、不改文件',
        '系统随机唤醒成员，每轮 6 次；主持人最后总结',
        '结论由你认可；不认可就继续讨论 6 次',
      ]
    : roomType.id === 'studio'
      ? [
          plan?.stages?.length > 0
            ? `阶段验收：${plan.stages.filter(stage => stage.acceptance).map(stage => `${stage.title} → ${stage.acceptance}`).join('；') || '人确认'}`
            : verify === 'test' ? `验收命令：${acceptance}` : '验收方式：人确认，不跑命令',
          '工作室使用群聊单工作目录：所有席位在房间目录执行，被 @ 才唤醒',
          ...(verifiers.length === 0
            ? ['这个房间没有独立验收席位，由你凭证据签字']
            : [independence === 'vendor'
              ? '执行与验收已绑定不同厂商；验收席位走盲审，不共享执行对话'
              : '当前只有同一厂商引擎可用：验收卡会标「独立性降级」']),
          ...(continueSource === null ? [] : [`续做自交接记录「${continueSource.name}」；上一轮记录保持只读`]),
        ]
      : [
          plan?.stages?.length > 0
            ? `阶段验收：${plan.stages.filter(stage => stage.acceptance).map(stage => `${stage.title} → ${stage.acceptance}`).join('；') || '人确认'}`
            : verify === 'test' ? `验收命令：${acceptance}` : '验收方式：人确认，不跑命令',
          align
            ? `${roleLabel(lead)} 只读/规划；${workers.map(roleLabel).join('、')} 在自己的 worktree${verifiers.length > 0 ? `；${verifiers.map(roleLabel).join('、')} 在一次性副本` : ''}`
            : `${workers.map(roleLabel).join('、')} 在自己的 worktree`,
          ...(verifiers.length === 0
            ? ['这个房间没有独立验收席位，由你凭证据签字']
            : [independence === 'vendor'
              ? '执行与验收已绑定不同厂商；验收席位走盲审，不共享执行对话'
              : '当前只有同一厂商引擎可用：验收卡会标「独立性降级」']),
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
          source: projectFile?.layers?.[0]?.name ?? projectPort.file,
          content: projectContent,
          layers: projectFile?.layers ?? [],
        },
      }),
  members: roster.map(seat => seat.id),
  roomType: roomType.id,
  engine: roomType.id === 'chat' ? 'chat' : 'delivery',
  ...(roomType.id === 'chat'
    ? {}
    : {
        closure: plan === null ? 'open' : 'planned',
        verificationMode: 'hybrid',
        verifierPolicy: verifierPolicy === 'majority' ? 'majority' : 'all',
      }),
  orchestration,
  ...(roomType.id === 'chat'
    ? {
        chat: {
          round: 1,
          phase: 'discussing',
          turns: 0,
          conclusionId: null,
          accepted: false,
          running: false,
          speaker: '',
          note: '',
        },
      }
    : { stages: builtStages.stages }),
})

export const initialRoomMessages = ({
  room,
  plan,
  templateId,
  roster,
  builtStages,
  continueSource,
  projectContent,
  projectFile,
  workspaces,
  engineFallbacks,
}) => {
  const workspaceNote = room.roomType === 'chat'
    ? '聊天室 · 只读讨论'
    : room.roomType === 'studio'
      ? '工作室 · 群聊单工作目录'
      : `${roster.length} 席各自工作区`
  const messages = [{
    kind: 'system',
    text: room.roomType === 'chat'
      ? '房间已创建 · 聊天室 · 只读讨论'
      : plan !== null
        ? `房间已创建 · 开工卡已确认 · ${workspaceNote}`
        : `房间已创建 · 模板 ${TEMPLATES[templateId].name} · ${workspaceNote}`,
  }]
  for (const text of builtStages.messages ?? []) messages.push({ kind: 'system', text })
  if (room.branch !== '') messages.push({ kind: 'system', text: `源仓库 ${room.sourceRepo} · 执行分支 ${room.branch}` })
  if (continueSource !== null) {
    messages.push({
      kind: 'system',
      text: `续做自交接记录「${continueSource.name}」（${continueSource.id}）；旧记录不复活，只作为 BRIEF 与证据的出处。`,
    })
  }
  if (projectContent !== '') {
    messages.push({
      kind: 'system',
      text: `已带入项目约束：${projectFile?.layers?.length ?? 1} 层（${projectContent.split('\n').filter(line => line.trim() !== '').length} 行，创建时快照）。`,
    })
  }
  const envWarnings = Object.entries(workspaces.environment ?? {})
    .flatMap(([seat, env]) => (env.warnings ?? []).map(text => `${seat}: ${text}`))
  if (envWarnings.length > 0) messages.push({ kind: 'system', text: `工作区环境同步警告：${envWarnings.join('；')}` })
  const mcpSeats = roster.filter(seat => seat.mcp.length > 0)
  if (mcpSeats.length > 0) {
    messages.push({
      kind: 'system',
      text: `MCP 已开启：${mcpSeats.map(seat => `${seat.name}（${seat.mcp.map(grant => grant.server).join('、')}）`).join('；')}。调用写 events.jsonl；单个工具失败只影响当前席位回合，房间继续。`,
    })
  }
  if (Object.keys(engineFallbacks).length > 0) {
    const text = Object.entries(engineFallbacks)
      .map(([seat, item]) => `${seat} 请求 ${item.requested}，实际 ${item.actual}`)
      .join('；')
    messages.push({
      kind: 'system',
      text: `引擎降级：${text}。跨厂商独立性不成立，验收卡会按实际引擎标注。`,
    })
  }
  return messages
}
