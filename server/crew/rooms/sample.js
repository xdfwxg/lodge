import { CHAT_PHASE, ROOM_STATE, ROUND_STATUS, STAGE_STATE } from '../../../shared/states.js'

export const SAMPLE_ROOM_ID = 'room-sample'
export const SAMPLE_CHAT_ROOM_ID = 'room-sample-chat'
export const SAMPLE_ROUND_ID = 'round-sample-1'

const member = ({ id, name, role, roleKind, station, permissions, title, voice, personality, stance }) => ({
  id,
  name,
  title: title ?? (roleKind === 'planner' ? '规划' : roleKind === 'verifier' ? '复核' : '实现'),
  role,
  roleKind,
  roleProfile: name,
  station,
  ...(voice === undefined ? {} : { voice }),
  ...(personality === undefined ? {} : { personality }),
  ...(stance === undefined ? {} : { stance }),
  permissions,
  writeScope: roleKind === 'executor' ? 'repo' : 'none',
  toolSurface: roleKind === 'verifier' ? ['read'] : ['read', 'write', 'exec'],
  approval: 'auto',
  body: {
    kind: 'base',
    ref: `sample-${id}`,
    name,
    engine: 'demo',
    spec: { prompt: '', skills: [], mcp: [] },
  },
})

const participant = ({ id, name, title, station, voice, personality, stance }) => member({
  id,
  name,
  title,
  role: 'participant',
  roleKind: 'participant',
  station,
  voice,
  personality,
  stance,
  permissions: { read: true, exec: false, write: false },
})

const STEPS = [
  { title: '目标对齐', kind: 'decision', state: STAGE_STATE.passed },
  { title: '写一段试写', kind: 'deliverable', state: STAGE_STATE.passed, deliverable: '一段试写正文' },
  { title: '验收与结论', kind: 'decision', state: STAGE_STATE.passed, dependsOn: [1] },
]

export const sampleRoomRecord = ({ now = Date.now() } = {}) => ({
  id: SAMPLE_ROOM_ID,
  kind: 'room',
  name: '示例：把《羽仙记》的结尾改得更看得见',
  goal: '把《羽仙记》的结尾改得更看得见：只改一处，用动作代替旁白',
  templateId: 'custom',
  roomType: 'studio',
  engine: 'demo',
  demo: true,
  live: false,
  state: ROOM_STATE.idle,
  activeRoundId: null,
  lastRoundId: SAMPLE_ROUND_ID,
  idle: true,
  orchestration: 'pipeline',
  completedAt: now - 3 * 60_000,
  completedCommit: null,
  leadMemberId: 'planner',
  verifiers: ['verifier'],
  workers: ['executor'],
  independence: 'human',
  members: [
    member({ id: 'planner', name: '规划师', role: 'lead', roleKind: 'planner', station: '定步骤 · 派活', permissions: { read: true, exec: false, write: false } }),
    member({ id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor', station: '写试写 · 交结果', permissions: { read: true, exec: true, write: true } }),
    member({ id: 'verifier', name: '验收员', role: 'verifier', roleKind: 'verifier', station: '只读 · 判断达没达到', permissions: { read: true, exec: false, write: false } }),
  ],
  plan: {
    done: ['有一段可对照的试写', '改动只发生在结尾一处'],
    prose: '我分两步：先把结尾改成动作，再让验收员对照原文看一遍。只改一处，不重写整篇。',
    stages: [{ title: '写一段试写', kind: 'deliverable', deliverable: '一段试写正文' }],
  },
  stages: STEPS,
  constraints: [
    '示例房间不接模型，内容都是样例',
    '只改结尾一处；试写是段落级对照，不是重写整篇',
  ],
  chatRoom: null,
  chatHost: null,
  workspace: {
    provider: 'demo',
    capabilities: { vcs: 'none', isolation: 'none', commit: false, diff: 'none' },
  },
  repoPath: null,
  sourceRepo: null,
  branch: null,
  worktrees: {},
  branches: {},
  ports: {},
  workspaceEnv: {},
  capabilities: {},
  idle: false,
  turnCount: 0,
  noProgress: 0,
  turnQueue: [],
  heldMembers: [],
  heldMessages: {},
})

export const sampleStudioRound = ({ room, now = Date.now() } = {}) => ({
  id: SAMPLE_ROUND_ID,
  roomId: room.id,
  projectId: null,
  ordinal: 1,
  status: ROUND_STATUS.completed,
  name: room.name,
  goal: room.goal,
  plan: room.plan,
  stages: room.stages,
  gate: null,
  shadowReview: false,
  orchestration: room.orchestration ?? null,
  constraints: room.constraints ?? [],
  decisions: [],
  usage: room.usage,
  openQuestion: null,
  lastPlannerDecision: null,
  blocked: null,
  mergeConflict: null,
  stageBases: {},
  stageBaseManifests: {},
  startHead: null,
  workspaceHead: null,
  completedAt: room.completedAt ?? now - 3 * 60_000,
  completedCommit: null,
  completion: {
    goal: room.goal,
    stages: (room.stages ?? []).map(stage => ({ title: stage.title, kind: stage.kind, state: stage.state })),
    decisions: [],
    constraints: (room.constraints ?? []).slice(0, 6),
    completedAt: room.completedAt ?? now - 3 * 60_000,
    completedCommit: null,
  },
  origin: { sourceRoomId: null, sourceName: null },
  previousRoundId: null,
  startedAt: (room.completedAt ?? now) - 60_000,
  createdAt: (room.completedAt ?? now) - 60_000,
})

export const seedSampleMessages = ({ store, room } = {}) => {
  const append = message => store.appendMessage(room.id, message)

  append({
    kind: 'plan',
    authorId: 'planner',
    text: room.plan.prose,
  })
  append({
    kind: 'system',
    authorId: 'planner',
    text: '@执行官 第 2 步「写一段试写」交给你：把结尾改成动作，让读者自己看见她留下；写完把段落发出来。',
    meta: { kind: 'handoff', stage: 1, reason: 'dispatch', from: 'planner', to: ['executor'], authorKind: 'system' },
  })
  append({
    kind: 'chat',
    authorId: 'executor',
    text: '改好了，只动结尾：她把羽衣叠好放回箱里，却把兰香囊解下来，挂到了门外。这样读者能看见她留下，不用旁白解释。',
  })
  append({
    kind: 'system',
    authorId: 'executor',
    text: '@验收员 第 2 步做完了，帮我对照原文看一下。',
    meta: { kind: 'handoff', stage: 1, reason: 'review', from: 'executor', to: ['verifier'], authorKind: 'system' },
  })
  append({
    kind: 'verdict',
    authorId: 'verifier',
    text: '通过：结尾改成了动作，读者能自己看见她留下；改动只在结尾一处，没有重写整篇。',
    meta: {
      pass: true,
      stage: 1,
      reason: '结尾改成了动作，读者能自己看见她留下；改动只在结尾一处。',
      review: true,
    },
  })
  append({
    kind: 'chat',
    authorId: 'planner',
    text: '验收通过：动作替代了旁白，改动也控制在结尾一处。这间房的目标完成，收尾。',
  })
}

export const sampleChatRoomRecord = ({ now = Date.now() } = {}) => ({
  id: SAMPLE_CHAT_ROOM_ID,
  kind: 'room',
  name: '示例：把「朏朏住在灵动岛上」聊成一个方向',
  goal: '聊聊：朏朏该住在灵动岛的哪里，怎么动才不打扰人',
  templateId: 'custom',
  roomType: 'chat',
  engine: 'demo',
  demo: true,
  live: false,
  state: ROOM_STATE.active,
  completedAt: null,
  completedCommit: null,
  leadMemberId: 'lodge-sample',
  verifiers: [],
  workers: [],
  independence: 'human',
  members: [
    member({ id: 'lodge-sample', name: 'Lodge', title: '主持', role: 'lead', roleKind: 'participant', station: '开场 · 收敛', permissions: { read: true, exec: false, write: false } }),
    participant({ id: 'he', name: '阿禾', title: '编辑', station: '听故事 · 找句子', voice: '先看故事讲不讲得通。', personality: 'gentle', stance: 'synthesizer' }),
    participant({ id: 'man', name: '小满', title: '设计', station: '看位置 · 管动效', voice: '先看位置，再看会不会挡内容。', personality: 'cheerful', stance: 'proposer' }),
    participant({ id: 'zhou', name: '老周', title: '工程', station: '算成本 · 提限制', voice: '先算成本，再问会不会坏。', personality: 'rigorous', stance: 'critic' }),
  ],
  plan: null,
  stages: [],
  constraints: [
    '示例房间不接模型，内容都是样例',
    '聊天室只讨论，不改文件、不调用工具',
    '聊完可以一键转成工作室',
  ],
  chat: {
    round: 1,
    phase: CHAT_PHASE.concluded,
    turnLimit: 4,
    turns: 4,
    conclusionId: null,
    running: false,
    speaker: '',
    note: '',
  },
  chatRoom: null,
  chatHost: { memberRef: 'lodge-sample', name: 'LodgeSampleHost', displayName: 'Lodge' },
  workspace: {
    provider: 'demo',
    capabilities: { vcs: 'none', isolation: 'none', commit: false, diff: 'none' },
  },
  repoPath: null,
  sourceRepo: null,
  branch: null,
  worktrees: {},
  branches: {},
  ports: {},
  workspaceEnv: {},
  capabilities: {},
  idle: false,
  turnCount: 0,
  noProgress: 0,
  turnQueue: [],
  heldMembers: [],
  heldMessages: {},
})

export const seedSampleChatMessages = ({ store, room } = {}) => {
  const append = message => store.appendMessage(room.id, message)

  append({
    kind: 'chat',
    authorId: 'lodge-sample',
    text: '今天我们聊一个具体的问题：岛上那只朏朏，住在灵动岛的什么位置，怎么动才不打扰人？',
    meta: { opening: true, round: 1 },
  })
  append({
    kind: 'chat',
    authorId: 'man',
    text: '我倾向让它待在上沿，像一只小狸趴在窗台上。别绕整圈，绕到下面会挡住内容。',
  })
  append({
    kind: 'chat',
    authorId: 'zhou',
    text: '上沿没问题，但别一直走。平常趴着，只有房间在干活时才走两步，动效预算也省。',
  })
  append({
    kind: 'chat',
    authorId: 'he',
    text: '从讲故事看，“平时趴着、忙时巡线”本身就是叙事：安静的时候它陪着你，忙起来它替你看着。',
  })
  append({
    kind: 'chat',
    authorId: 'man',
    text: '颜色也别跳。白毛白尾、脖子一圈软鬃就够了；金色只留在眼睛和铃铛上。',
  })
  const conclusion = append({
    kind: 'chat_conclusion',
    authorId: 'lodge-sample',
    text: '收敛到一个方向：让一只朏朏住在上沿，平时趴着，干活时沿边线走两步，不绕整圈、不挡内容；白毛白尾，金色只留在眼睛和铃铛上。',
    meta: { round: 1, turnLimit: 4, turns: 4, host: 'lodge-sample', fallback: false, at: Date.now() },
  })
  store.updateRoom?.(room.id, current => {
    current.chat = { ...(current.chat ?? {}), conclusionId: conclusion.id }
    return { events: [] }
  })
}
