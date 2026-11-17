export const SAMPLE_ROOM_ID = 'room-sample'

const member = ({ id, name, role, roleKind, station, permissions }) => ({
  id,
  name,
  title: roleKind === 'planner' ? '规划' : roleKind === 'verifier' ? '验收' : '执行',
  role,
  roleKind,
  roleProfile: name,
  station,
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

const STEPS = [
  { title: '目标对齐', kind: 'decision', state: 'passed' },
  { title: '写一段试写', kind: 'deliverable', state: 'passed', acceptance: 'manual', manual: true },
  { title: '验收与结论', kind: 'decision', state: 'passed', dependsOn: [1] },
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
  state: 'complete',
  closure: 'signed',
  verificationMode: 'manual',
  orchestration: 'pipeline',
  completedAt: now - 3 * 60_000,
  completedCommit: null,
  leadMemberId: 'planner',
  verifiers: ['verifier'],
  workers: ['executor'],
  independence: 'human',
  members: [
    member({ id: 'planner', name: '规划', role: 'lead', roleKind: 'planner', station: '定步骤 · 派活', permissions: { read: true, exec: false, write: false } }),
    member({ id: 'executor', name: '执行', role: 'worker', roleKind: 'executor', station: '写试写 · 交结果', permissions: { read: true, exec: true, write: true } }),
    member({ id: 'verifier', name: '验收', role: 'verifier', roleKind: 'verifier', station: '只读 · 判断达没达到', permissions: { read: true, exec: false, write: false } }),
  ],
  plan: {
    done: ['有一段可对照的试写', '改动只发生在结尾一处'],
    prose: '我分两步：先把结尾改成动作，再让验收员对照原文看一遍。只改一处，不重写整篇。',
    stages: [{ title: '写一段试写', kind: 'deliverable', acceptance: 'manual', manual: true }],
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
  parentRoomId: null,
  depth: 0,
  childRoomIds: [],
  idle: false,
  round: 0,
  noProgress: 0,
  turnQueue: [],
  heldMembers: [],
  heldMessages: {},
})

export const seedSampleMessages = ({ store, room } = {}) => {
  const append = message => store.appendMessage(room.id, message)

  append({
    kind: 'plan',
    authorId: 'planner',
    text: room.plan.prose,
  })
  append({
    kind: 'handoff',
    authorId: 'planner',
    text: '@执行 第 2 步「写一段试写」交给你：把结尾改成动作，让读者自己看见她留下；写完把段落发出来。',
    meta: { stage: 1, status: 'sent' },
  })
  append({
    kind: 'chat',
    authorId: 'executor',
    text: '改好了，只动结尾：她把羽衣叠好放回箱里，却把兰香囊解下来，挂到了门外。这样读者能看见她留下，不用旁白解释。',
  })
  append({
    kind: 'handoff',
    authorId: 'executor',
    text: '@验收 第 2 步做完了，帮我对照原文看一下。',
    meta: { stage: 1, status: 'sent' },
  })
  append({
    kind: 'verdict',
    authorId: 'verifier',
    text: 'PASS 结尾改成了动作，读者能自己看见她留下；改动只在结尾一处，没有重写整篇。',
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
