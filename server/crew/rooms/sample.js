import { createHash } from 'node:crypto'

export const SAMPLE_ROOM_ID = 'room-sample'

const CHECKLIST = `# 发布前检查清单

## 代码与构建
- [ ] 主分支 CI 通过
- [ ] 版本号与构建结果一致
- [ ] 没有未合并的临时改动

## 发布
- [ ] 数据库迁移已演练
- [ ] 环境变量与密钥已确认
- [ ] 灰度名单已准备

## 回滚
- [ ] 上一版构建可下载
- [ ] 回滚步骤有负责人
- [ ] 发布后 30 分钟有人盯监控
`

const DIFF = `+ # 发布前检查清单
+
+ ## 代码与构建
+ - [ ] 主分支 CI 通过
+ - [ ] 版本号与构建结果一致
+ - [ ] 没有未合并的临时改动
+
+ ## 发布
+ - [ ] 数据库迁移已演练
+ - [ ] 环境变量与密钥已确认
+ - [ ] 灰度名单已准备
+
+ ## 回滚
+ - [ ] 上一版构建可下载
+ - [ ] 回滚步骤有负责人
+ - [ ] 发布后 30 分钟有人盯监控`

const sha256 = text => createHash('sha256').update(text).digest('hex')

export const sampleRoomRecord = ({ now = Date.now() } = {}) => ({
  id: SAMPLE_ROOM_ID,
  kind: 'room',
  name: '示例：发布前检查清单',
  goal: '把发布前的检查做成一份人人能照着勾的清单。',
  roomType: 'studio',
  engine: 'demo',
  demo: true,
  live: false,
  state: 'complete',
  closure: 'signed',
  completedAt: now - 3 * 60_000,
  completedCommit: null,
  leadMemberId: 'planner',
  memberCursors: {},
  members: [
    {
      id: 'planner',
      kind: 'ai',
      name: '规划师',
      title: '规划',
      role: 'lead',
      roleKind: 'planner',
      station: '只读 · 拆阶段与派活',
      engine: 'demo',
      permissions: { read: true, exec: false, write: false },
      writeScope: 'none',
      toolSurface: ['read'],
      skills: [],
      mcp: [],
      approval: 'ask',
      speakBudget: 6,
      body: { kind: 'base', ref: 'sample-planner', name: '规划师' },
    },
    {
      id: 'executor',
      kind: 'ai',
      name: '执行官',
      title: '实现',
      role: 'worker',
      roleKind: 'executor',
      station: '独立副本写 · 改代码跑测试',
      engine: 'demo',
      permissions: { read: true, exec: true, write: true },
      writeScope: 'own_worktree',
      toolSurface: ['read', 'exec', 'write'],
      skills: [],
      mcp: [],
      approval: 'auto',
      speakBudget: 8,
      body: { kind: 'base', ref: 'sample-executor', name: '执行官' },
    },
    {
      id: 'verifier',
      kind: 'ai',
      name: '验收员',
      title: '复核',
      role: 'verifier',
      roleKind: 'verifier',
      station: '只读 · 只写结论',
      engine: 'demo',
      permissions: { read: true, exec: true, write: false },
      writeScope: 'none',
      toolSurface: ['read', 'exec'],
      skills: [],
      mcp: [],
      approval: 'ask',
      speakBudget: 6,
      body: { kind: 'base', ref: 'sample-verifier', name: '验收员' },
    },
  ],
  independence: 'model',
  plan: {
    done: [
      '覆盖代码、发布、回滚三组检查',
      '每条都能勾选，并有负责人',
      '单文件 Markdown，放在房间工作区',
    ],
    why: '这份清单要能被下一位值班同事直接拿去用，所以先确认三组结构和验收方式。',
  },
  stages: [
    {
      title: '目标对齐',
      kind: 'decision',
      state: 'passed',
      tasks: [{ owner: 'planner', title: '对齐目标', status: 'done' }],
    },
    {
      title: '写发布检查清单',
      kind: 'deliverable',
      state: 'passed',
      acceptance: 'test -f RELEASE_CHECKLIST.md',
      tasks: [{ owner: 'executor', title: '写清单', status: 'done' }],
    },
    {
      title: '检查与结论',
      kind: 'decision',
      state: 'passed',
      tasks: [{ owner: 'verifier', title: '复核清单', status: 'done' }],
    },
  ],
  workspace: {
    provider: 'demo',
    capabilities: { vcs: 'none', isolation: 'none', commit: false, diff: 'none' },
  },
  repoPath: null,
  sourceRepo: null,
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
  busy: false,
  turnQueue: [],
  presence: [],
  approvals: [],
  openQuestion: null,
  gate: null,
  pastGoals: [],
  version: 1,
})

export const seedSampleMessages = ({ store, room, now = Date.now() } = {}) => {
  const append = message => store.appendMessage(room.id, message)

  append({
    kind: 'system',
    text: '这是一间示例房间：所有内容都是样例数据，可以直接查看交付卡，也可以删掉。',
  })
  append({
    kind: 'chat',
    authorId: 'planner',
    text: '**目标对齐 · 结论**\n\n- 目标：给准备发布的团队一份能直接照着勾的清单。\n- 结构：代码、发布、回滚三组，每条带勾选框和负责人。\n- 检查：文件里三组检查齐全，能直接照着勾。\n\n@you 定下这三点后，交执行官写清单。',
  })
  append({
    kind: 'handoff',
    authorId: 'planner',
    text: '把清单交给执行官，按定下的结构落地。',
    meta: {
      from: 'planner',
      workers: ['executor'],
      stage: 1,
      acceptance: '文件存在且三组齐全',
      reason: 'dispatch',
      status: 'sent',
    },
  })
  append({
    kind: 'chat',
    authorId: 'executor',
    text: '**工作日志**\n\n- 做了什么：新建 `RELEASE_CHECKLIST.md`，按三组结构写了 9 条检查。\n- 结果：每条都有勾选框和负责人栏，没有改动其他文件。\n- 交给谁：交验收员核对结构与可读性。',
  })
  const evidence = append({
    kind: 'evidence',
    authorId: 'executor',
    text: '`RELEASE_CHECKLIST.md` 已写好，三组检查共 9 条。',
    meta: {
      kind: 'command',
      stage: 1,
      command: 'test -f RELEASE_CHECKLIST.md',
      exit: 0,
      durationMs: 180,
      sample: true,
      simulated: true,
      output: 'RELEASE_CHECKLIST.md',
      files: ['RELEASE_CHECKLIST.md'],
      changedFiles: ['RELEASE_CHECKLIST.md'],
      diff: DIFF,
      artifacts: [{
        path: 'RELEASE_CHECKLIST.md',
        bytes: Buffer.byteLength(CHECKLIST),
        sha256: sha256(CHECKLIST),
        content: CHECKLIST,
      }],
    },
  })
  append({
    kind: 'verdict',
    authorId: 'verifier',
    text: '已核对：三组检查齐全，每条都能勾选，负责人栏清晰；检查在示例工作区通过。',
    meta: { stage: 1, pass: true, evidenceId: evidence.id, sample: true },
  })
  append({
    kind: 'stage_conclusion',
    authorId: 'system',
    text: '清单已通过复核。',
    meta: { stage: 1, title: '写发布检查清单', next: '验收与结论' },
  })
  append({
    kind: 'conclusion',
    authorId: 'planner',
    text: '已交付：示例交付了一份能直接拿去用的发布前检查清单。',
    meta: { stages: 3, commands: ['test -f RELEASE_CHECKLIST.md'], sample: true },
  })
}
