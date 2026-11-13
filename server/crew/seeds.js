import { randomUUID } from 'node:crypto'
import { min, SEAT_IDS } from './seats.js'

export const ROOM_SEEDS = [
  {
    room: {
      id: 'room-cli-verbose',
      kind: 'room',
      name: 'CLI 加 --verbose',
      goal: '给 CLI 加 --verbose；默认输出必须逐字节不变',
      independence: 'vendor',
      state: 'active',
      demo: true,
      openQuestion: null,
      usage: { costMicroUsd: 41_200, budgetMicroUsd: 200_000, turns: 7 },
      members: SEAT_IDS,
      stages: [
        { title: '调研与接口设计', kind: 'decision', state: 'passed' },
        { title: '实现 --verbose', kind: 'deliverable', state: 'active', acceptance: 'npm test' },
        { title: '回归与文档', kind: 'deliverable', state: 'pending', acceptance: 'npm test && ./scripts/e2e.sh' },
      ],
    },
    messages: [
      { kind: 'system', at: min(18), text: '目标已对齐 · 3 个阶段' },
      { kind: 'chat', authorId: 'you', at: min(17), text: '做 `--verbose`。默认输出必须逐字节不变。先给方案，别动代码。' },
      {
        kind: 'chat',
        authorId: 'planner',
        at: min(15),
        text: [
          '按 done 拆成三段。第 1 段是决策型，需要你点一次；后两段都有可执行命令。',
          '',
          '| 阶段 | 类型 | 谁做 | 验收 |',
          '| --- | --- | --- | --- |',
          '| 1 调研与接口设计 | 决策 | 队长 | 你确认接口形状 |',
          '| 2 实现 --verbose | 交付 | 执行 | `npm test` 退出码 0，默认输出 diff 为空 |',
          '| 3 回归与文档 | 交付 | 执行 | `npm test && ./scripts/e2e.sh` |',
          '',
          '@执行 阶段 2 的写范围只有 `src/cli.js` 和 `test/cli.test.js`。默认一次只派一个子任务，报完工附证据再推进。',
        ].join('\n'),
      },
      { kind: 'system', at: min(12), text: '阶段 1 由你确认 · 接口形状：`--verbose` 只影响 stderr，stdout 逐字节不变' },
      {
        kind: 'chat',
        authorId: 'executor',
        at: min(6),
        text: [
          '改完了，没动依赖。',
          '',
          '- `src/cli.js`：新增 `--verbose`，日志只走 stderr；默认路径仍先写同一个 buffer 再一次性输出',
          '- `test/cli.test.js`：加 3 条用例，其中一条逐字节比对默认输出',
          '',
          '跑了 `npm test`，证据在下面。',
        ].join('\n'),
      },
      {
        kind: 'evidence',
        authorId: 'executor',
        at: min(5),
        meta: {
          stage: 1,
          sample: true,
          command: 'npm test',
          exit: 0,
          durationMs: 4_120,
          files: ['src/cli.js', 'test/cli.test.js'],
          output: '> cli@1.2.0 test\n> node --test\n\n✔ defaults are byte-identical (12ms)\n✔ --verbose logs to stderr (4ms)\n✔ --verbose with --json stays machine-readable (3ms)\n\n3 passing',
          diff: 'diff --git a/src/cli.js b/src/cli.js\n@@\n-  process.stdout.write(out)\n+  if (opts.verbose) process.stderr.write(`[cli] ${line}\\n`)\n+  process.stdout.write(out)',
        },
      },
      {
        kind: 'verdict',
        authorId: 'verifier',
        at: min(3),
        text: '复跑通过。另抽查默认输出与基线逐字节一致；`--verbose --json` 时 stderr 不污染 JSON。没有发现越界改动。',
        meta: { pass: true, stage: 1, command: 'npm test', exit: 0 },
      },
    ],
  },
  {
    room: {
      id: 'room-oauth',
      kind: 'room',
      name: '登录迁移 OAuth',
      goal: '把会话登录换成 OAuth；旧 cookie 路径保留一个版本',
      independence: 'vendor',
      state: 'active',
      demo: true,
      openQuestion: '回调地址用 `/auth/callback`，还是保持 `/oauth/callback`？',
      usage: { costMicroUsd: 12_600, budgetMicroUsd: 150_000, turns: 3 },
      members: SEAT_IDS,
      stages: [
        { title: '调研与接口设计', kind: 'decision', state: 'active' },
        { title: '接入 OAuth 回调', kind: 'deliverable', state: 'pending', acceptance: 'npm test' },
        { title: '旧 cookie 兼容', kind: 'deliverable', state: 'pending', acceptance: 'npm test && ./scripts/e2e.sh' },
      ],
    },
    messages: [
      { kind: 'system', at: min(95), text: '目标已对齐 · 3 个阶段' },
      { kind: 'chat', authorId: 'you', at: min(94), text: '把登录换成 OAuth，旧 cookie 路径保留一个版本。' },
      {
        kind: 'chat',
        authorId: 'planner',
        at: min(90),
        text: [
          '阶段 1 需要你拍板两件事：回调地址；旧 cookie 只读兼容一版，不做续期。',
          '',
          '1. 回调地址用 `/auth/callback` 还是 `/oauth/callback`？',
          '2. 旧 cookie 只读兼容，确认一版后删掉？',
          '',
          '推荐：`/auth/callback` + 只读兼容一版。@验收 到时候独立复跑迁移脚本。',
        ].join('\n'),
      },
    ],
  },
  {
    room: {
      id: 'room-readme',
      kind: 'room',
      name: 'README 补安装说明',
      goal: 'README 增加一节安装说明；不改变现有章节顺序',
      independence: 'none',
      engines: { planner: 'claude-cli', executor: 'claude-cli', verifier: 'claude-cli' },
      state: 'complete',
      demo: true,
      openQuestion: null,
      usage: { costMicroUsd: 8_400, budgetMicroUsd: 100_000, turns: 5 },
      members: SEAT_IDS,
      stages: [
        { title: '写安装一节', kind: 'deliverable', state: 'passed', acceptance: 'npm test' },
        { title: '跑一遍端到端', kind: 'deliverable', state: 'passed', acceptance: './scripts/e2e.sh' },
      ],
    },
    messages: [
      { kind: 'system', at: min(260), text: '目标已对齐 · 2 个阶段' },
      { kind: 'chat', authorId: 'you', at: min(258), text: 'README 加一节安装说明，别动现有章节顺序。' },
      { kind: 'chat', authorId: 'planner', at: min(250), text: '两段都是交付型；第 2 段带端到端。@执行 只改 `README.md`，写范围不带其他文件。' },
      {
        kind: 'evidence',
        authorId: 'executor',
        at: min(120),
        meta: {
          stage: 0,
          sample: true,
          command: 'npm test',
          exit: 0,
          files: ['README.md'],
          output: '> cli@1.2.0 test\n> node --test\n\n5 passing',
          diff: 'diff --git a/README.md b/README.md\n@@\n+## 安装\n+\n+```bash\n+npm install -g crew-cli\n+```\n+\n+安装后用 `crew --help` 确认。',
        },
      },
      { kind: 'verdict', authorId: 'verifier', at: min(110), text: '文档链接可点，安装命令与 `package.json` 的 bin 一致。', meta: { pass: true, stage: 0, command: 'npm test', exit: 0 } },
      {
        kind: 'evidence',
        authorId: 'executor',
        at: min(80),
        meta: {
          stage: 1,
          sample: true,
          command: './scripts/e2e.sh',
          exit: 0,
          files: ['README.md'],
          output: 'e2e: install from tarball\n✔ crew --help\n✔ crew init\n\n2 passing',
        },
      },
      { kind: 'verdict', authorId: 'verifier', at: min(70), text: '从 tarball 安装到 `crew --help` 全通，README 的步骤与脚本一致。', meta: { pass: true, stage: 1, command: './scripts/e2e.sh', exit: 0 } },
      {
        kind: 'conclusion',
        authorId: 'planner',
        at: min(65),
        text: 'README 新增「安装」一节，现有章节顺序未变；两次验收命令退出码均为 0。',
        meta: { stages: 2, commands: ['npm test', './scripts/e2e.sh'], files: ['README.md'] },
      },
    ],
  },
]

export const seedIfEmpty = store => {
  const roomCount = Number(store.db.prepare('SELECT COUNT(*) AS n FROM room').get().n)
  if (roomCount !== 0) return
  // 示例数据必须显式开启；空数据直接进入建房引导。
  const demo = process.env.CREW_SEED_DEMO === '1'
  const insertRoom = store.db.prepare('INSERT INTO room (id, payload) VALUES (?, ?)')
  let seq = 0
  if (demo) {
    for (const { room, messages } of ROOM_SEEDS) {
      insertRoom.run(room.id, JSON.stringify(room))
      for (const seed of messages) {
        const { at, ...rest } = seed
        seq += 1
        store.persistMessage({ ...rest, id: randomUUID(), roomId: room.id, seq, ts: Date.now() - at }, { transcript: false })
      }
      if (room.state === 'complete') {
        seq += 1
        store.persistMessage({
          kind: 'system',
          id: randomUUID(),
          roomId: room.id,
          seq,
          ts: Date.now() - min(64),
          text: '演示房间 · 不写 CONCLUSION.md，不产生 commit',
        }, { transcript: false })
      }
    }
  }
}
