# 复用地图 v2.0

> 2026-11-11 · 目标：用成熟、可扩展的运行时做地基，Crew Chat 只写产品差异层。
> 原则：**复用运行时，替换产品面；抄代码，不抄产品。**
>
> 分层与取舍判断见根目录 [`设计思想.md`](../设计思想.md)。
>
> **当前实现（2026-11-11）**：P0+ / M3 部分。设计目标是 `docs/crew-chat-design.md`；规则见 `设计思想.md`；§8.5 是唯一的状态入口。已成立：开工卡（done/编制/验收/≤3 问，一次确认）、席位按需组合、多执行并行、manual 人验收。未接：runtime Assignment、工具级权限强制、建后改席位、多验收席位、跨厂商盲审、审批桥、模板导入、Electron。

## 0. 选型结论

| 角色 | 选择 | 理由 |
|---|---|---|
| 基座 | **OpenMausBot OSS**（Apache-2.0） | 引擎驱动、Assignment 运行时、SQLite/SSE、Electron 壳都已成熟，且靠 driver/ACP 扩展 |
| 引擎 | **OpenMausBot drivers** | 原生 Claude/Codex 驱动 + ACP；新增 CLI 是加 driver 或一条配置，核心不动 |
| UI 参考 | **Claude-Bot / DS Bot**（Apache-2.0） | 优秀设计可复用（含代码/CSS）；保留 LICENSE、NOTICE 与文件头；不引入 DSH 宿主/插件/store 耦合；当前 UI 自写 |
| 产品层 | **Crew Chat 自写** | 房间即仓库、阶段验收、证据、跨厂商独立性、席位模板 |

明确不采用：LangGraph / CrewAI / AutoGen 这类编排框架；也不自写 CLI spawn 层。前者多一层状态真相，后者会重造 OpenMausBot 已经做对的引擎管理。

当前 spike 是独立基座仓库 `crew-chat-base`（8799），通过 HTTP 接入；还不是单体 fork，Electron 打包待 S5。

### 基座形态：推荐 A，备选 B

**A（推荐）以 OpenMausBot OSS 为基座 fork**
- 删 `enterprise/`，保留 `server/runtime`、`server/drivers`、`server/engine-*`、Electron 壳。
- 新增 `server/crew/`（房间、阶段、证据）与 Crew Chat UI；当前 `ui/` 整体迁入。
- 保留 `upstream` remote，引擎更新按 driver 粒度 cherry-pick。
- 代价：仓库大（约 7,660 个文件、1,565 个 server TS 文件），产品面要删；收益：引擎/认证/安装/更新全部现成，且持续可跟上游。

**B 在 crew-chat 里按模块移植**
- 只搬 `runtime` + 选中的 driver。实测 `claude.ts` 与 `acp/core.ts` 各 44 条 import，牵扯 config、procs、auth、catalog、engine home 等一整片；搬完等于维护一个私有分叉，且拿不到上游更新。
- 仅在 A 的删除成本被证明不可控时启用。

**两天 spike 判据**：基座能启动、我们的 UI 能接上、一个房间能跑一次真实 Claude turn、证据落盘。不满足再转 B。

## 1. 分层与扩展点

```
┌ UI（Crew Chat 自己的视觉与状态层）──────────────┐
├ 产品层  server/crew/  房间即仓库·阶段·证据·独立性   ┤  ← 自己写
├ 协调层  runtime       Assignment 生命周期·不变量    ┤  ← 复用
├ 引擎层  drivers       Claude/Codex/ACP·权限·目录     ┤  ← 复用
├ 存储层  message-db     SQLite·事件·SSE·重放          ┤  ← 复用
└ 外壳    electron      窗口·打包·更新                 ┘  ← 复用
```

扩展只有一条路径，不 fork 核心：

| 要加什么 | 改哪里 | 动核心？ |
|---|---|---|
| 新引擎 | 新 driver + `drivers/builtIn.ts` 注册，或 `customAcp` 配置 | 否 |
| 新模型 | `model-catalog/` 与对应 `*-catalog.ts` | 否 |
| 新席位 | 席位模板（bot + 角色 + 权限 + 引擎绑定） | 否 |
| 新阶段类型 | `server/crew/stages` 增加 kind 与 gate | 产品层 |
| 新验收方式 | `server/crew/acceptance` 增加 runner | 否 |
| 新事件 | `shared/wire` + UI store | 视情况 |

## 2. OpenMausBot：直接复用

以基座 fork 为前提，“复用”指保留并接线，不是复制到另一个仓库。

| 模块 | 能力 | 接线工作 |
|---|---|---|
| `server/runtime/{types,runtime,store,tree,invariants,level,envelope,questions,capabilities}.ts` | Assignment 全生命周期、事件重放、状态不变量、问题挂起、结果信封 | 宿主 `TurnRunner` 接我们的房间回合；**不变量一行不改** |
| `server/drivers/{builtIn,claude,codex,acp/*,native,retry,tool-*}.ts` | 原生 Claude/Codex、ACP 多引擎、工具事件、重试、限额 | 席位→botId 的引擎绑定 |
| `server/engine-{install,updates,handshake,versions,limits,roots,memory}.ts` | 引擎安装、版本探测、更新、握手 | 无 |
| `server/drivers/claude-auth-*`、`claude-login-auth.ts`、`codex-login.ts`、`device-auth.ts` | 登录、OAuth/设备码、失效恢复 | 无 |
| `server/model-catalog/`、`startup-model-catalog.ts`、`drivers/*-catalog.ts` | 模型目录与探测 | 无 |
| `server/message-db.ts`、`thread-events.ts`、`sse-fanout.ts` | SQLite WAL、事件表、SSE 背压/心跳/重连 | `thread` → `room` 的 id 映射 |
| `server/permission-proxy.ts`、`auto-approve.ts`、`runtime/questions.ts` | 权限请求、审批、人工提问 | 席位权限表映射到 approval mode |
| `server/room-{context,cwd,folder,holds,lines,question-tasks}.ts` | 房间成员上下文、固定目录、@ 持有与释放 | 直接用于 Room 会话 |
| `server/group-goal-run.ts` | 群目标的多轮协调与完成判定 | **只作参考**：它没有阶段签字与证据门禁 |
| `electron/main.mjs`（3,160 行）、`electron-builder.yml`、preload、更新模块 | 窗口、生命周期、打包、自动更新 | 换品牌、删无关面板 |
| `src/components/{ApprovalCard,QuestionCard,AskCard}.tsx` | 审批/提问卡交互 | 只借状态机；样式按 Crew Chat CSS 重写，不引 Tailwind |

## 3. OpenMausBot：适配后复用

| 模块 | 改动 | 风险 |
|---|---|---|
| `server/runtime/types.ts` 的 `Assignee` / `Destination` | `botId` → 席位 id；`thread` → Room thread | 改动会扩散到 store 校验，先写适配层，不直接改类型 |
| `server/group-goal-run.ts` | 协调循环保留；阶段推进改由 `server/crew/stages` 判定 | 它的完成判定是模型输出，不能替代人的签字 |
| `src/state/store.tsx`（约 3,300 行） | **不复用**；Crew Chat 现有 store 接 `thread-events` | 它绑 bot-as-person 概念与整套页面 |
| `src/components/*` 的引擎设置页 | 可作为「高级」面板参考 | 状态与 wire 耦合深，首版只做最小设置 |
| `server/openmausbot.ts` 宿主装配 | 换成 Crew Chat 宿主，只装 runtime + 选中 driver + crew 模块 | 宿主入口虽短，装配面很宽；按能力逐项打开 |

## 4. Claude-Bot / DS Bot：优秀设计可复用，保留许可与归属

| 资产 | 结论 | 说明 |
|---|---|---|
| 侧栏、气泡、输入框、折叠卡、@ 菜单的视觉与交互 | **已吸收** | 当前 `ui/src/crew.css` 与组件即由此演进，不再二次搬代码 |
| `ds-bot/src/client/*` | **按模块复用** | 是 DSH 插件 UI，import `@deepseek-ai/dsh-client-*`；只取不依赖 DSH 的部分，保留许可/归属，不整包搬 |
| `app/ui`（休眠的独立 UI 分支） | **不搬** | 只服务单 bot，不服务群；群聊由 DSH 壳渲染 |
| `ds-bot/src/host/local-agents/*` | **不搬** | OpenMausBot 的原生驱动与 ACP 更完整（认证、安装、版本门禁） |
| `ds-bot/src/host/goals.js` | **设计参考** | 状态与证据门禁可看；`pass` 只校验证据非空，不执行命令 |
| `ds-bot/src/client/goal.js`（目标岛） | **照设计重写** | 目标岛布局、阶段步进器、任务行、状态语言直接采纳（§9.7）；代码绑 `BotMark`/`i18n`/DSH 样式，不搬组件，按 Crew Chat CSS 重写 |
| `ds-bot/src/host/skills/goal-grill/SKILL.md` | **照设计重写** | 只参考对齐流程；不直接复制技能正文。队长提示词由 Crew Chat 自写 |
| `app/src/main.mjs` 的 Electron 结构 | **不搬** | OpenMausBot 的壳更完整；只参考窗口/权限细节 |

已实测的坑，继续有效：

1. 不要 import `ds-bot/src/client/sidebar.js`：会引出 `deep-view/*` 与整张 DSH 依赖图。视觉与 CSS 可以复用优秀设计，但保留许可/归属，不要把 DSH 依赖带进来。
2. 组件是 `createElement` 写法，不要顺手改成 TSX，否则 diff 失控。
3. `app/ui` 的 `useChat` 在 `botId === undefined` 时直接返回，房间时间线必须自己写。
4. 两套样式系统不能混：不为了三张卡引入 Tailwind。

## 5. Crew Chat 自己写

1. **房间即仓库**：`BRIEF.md`（人）、`GOAL.md`/`CONCLUSION.md`（运行时投影）、`transcript.jsonl`、`evidence/`，完成时一次本地 commit，不 push；`decisions.md` 归人，运行时不写。
2. **阶段与门禁**：`decision` 阶段要人点；`deliverable` 阶段要验收命令 + Verifier PASS；`openQuestion` 未答不能确认。
3. **验收执行器**：一次性副本、超时、环境变量白名单、退出码与产物哈希；明确「协作隔离，不是安全边界」。
4. **跨厂商独立性**：`vendor | model | none`，降级在验收卡上标注；盲审与同厂商复核提示。
5. **席位模板与权限**：Planner 只读、Executor worktree 写、Verifier 只读；模板可换，不改核心。
6. **产品 UI**：当前 `ui/` 的房间、调度台、证据回执、完成态；状态层接基座事件。
7. **调度台**：一句话 → 建议交给哪个群；接 OpenMausBot 的请求/建议形态，不重造。
8. **Crew Chat 宿主装配**：只装 runtime + 首版 driver + crew 模块，不把 OpenMausBot 的全部能力都打开。

## 6. 明确不搬 / 首版不装

| 东西 | 原因 |
|---|---|
| `enterprise/` | 商业授权，一行不进 |
| OpenMausBot 的完整产品 UI | 绑 bot-as-person 与 3,300 行 store，产品面要换 |
| `browser/`、`computer-use`、`phone`、`email`、`meetings`、`postiz`、`connectors`、`cloud`、`companion`、`mobile` | 与首版无关，扩大攻击面与打包体积 |
| `routines/`、`sentinel/`、`decider/` | 定时与自动决策，首版不需要；保留接口不启用 |
| Claude-Bot 的 DSH 宿主与插件注册 | 多一层宿主就多一份状态真相 |
| `state.json` 作为唯一存储 | 要 SQLite 事务 + transcript 先写 |
| 群日志 60 行上限 | 与「房间持有完整历史」冲突 |
| OpenMausBot `runtime-coordinator.ts` | 与宿主强耦合 |
| 第三方编排框架 | 多一层状态机，且与「用你自己的 CLI」冲突 |

## 7. 目录（基座 fork 后）

```
openmausbot/                  # 上游 OSS，保留 remote
  server/
    runtime/                  # 复用，不改不变量
    drivers/                  # 复用，引擎扩展点
    engine-*.ts               # 复用
    crew/                     # 自己写：room repo / stages / evidence / seats
    crew-host.ts              # 自己写：只装配需要的模块
  ui/                         # 当前 Crew Chat UI 迁入
  electron/                   # 复用，换品牌与入口
  templates/                  # 席位模板
  docs/
    crew-chat-design.md
    reuse-map.md
```

## 8. 拼装顺序

| 步 | 做什么 | 判据 |
|---|---|---|
| S0 | fork OSS，删 `enterprise/`，跑通 `pnpm dev` 与现有测试 | 基座能启动，`edition: oss` |
| S1 | 迁入 Crew Chat UI，接 `thread-events`/SSE，一个房间显示历史 | 关掉重开一致 |
| S2 | `server/crew/`：BRIEF、transcript、evidence、阶段门禁；接 runtime Assignment | 一个 decision 阶段由人确认，一个 deliverable 阶段有证据 |
| S3 | 接真实 Claude Code（原生 driver），跑一条完整链路 | 命令退出码、输出、diff 入 evidence，Verifier 复核，人签字，commit |
| S4 | 接 Codex 或第二个 ACP 引擎，打开跨厂商独立性 | 验收卡显示 `vendor`，降级时显示 `none` |
| S5 | Electron 打包（arm64），签名与自动更新 | Mac M 芯片可安装、可更新 |

**进度（2026-11-11）**：S0 通过。S1 以「原型独立运行 + 适配层」的方式走通：基座群映射为实时房间，历史消息、实时 `activity`、`msg.patch` 与重连均可用；尚未把 UI 源码迁进基座。S2 已走通（见 §8.1、§8.2），业务层按「上游边界」规则收进 `server/crew/`，基座差异只出现在 `server/base.js`（传输）与 `server/engine.js`（语义适配）。S3 已走通（见 §8.3）：真实 CLI 回合 → 房间仓库执行验收命令 → 退出码/输出/diff 落证据 → 验收席位复核 PASS → 人签字 → 一次本地 commit。未接 runtime Assignment，也没有引入上游编排层。

## 8.1 Spike 记录（2026-11-11）

> 下面 S1/S2 里的 `.data/rooms/...` 是历史 spike 路径；当前产物在房间仓库的 `.crew/rooms/<id>/`。

- 基座：`crew-chat-base`，`8799`，`edition: oss`；`enterprise/` 已删，上游 remote 保留。
- 适配层：`crew-chat/server/base.js` 读 `GET /api/bots?messages=0`、`GET /api/threads/{id}/messages`、订阅 `/api/events`、`POST /api/groups/{id}/messages`。
- 房间映射：基座群 `crew-spike` → 房间 `cbd453e5-…`；一个 deliverable 阶段；成员仅 `executor`；`independence: none`（显示「独立性降级」）。
- 真实回合：从房间发一句需求，Claude Code 完成 `Write hello.txt`，digest 含 `Write ×1`、`durationMs ≈ 5s`。
- 证据：`.data/rooms/<roomId>/evidence/<messageId>.json`，`meta.kind: 'turn'`，记录工具摘要、回合耗时、产物路径 / 字节数 / sha256 与原始 digest；sha256 与磁盘 `hello.txt` 实测一致。
- 已知缺口：无暂停/停止/阶段验收；发送消息直接进基座群；证据目录在原型 `.data/`，尚未落到用户仓库（这正是 S2 要解决的）。

## 8.2 S2 记录（2026-11-11）

- 产物落到目标仓库：`.crew/rooms/<id>/{BRIEF.md,GOAL.md,CONCLUSION.md,transcript.jsonl,evidence/*.json}`；实时房间用基座群绑定的 `cwd`，手动房间用 `CREW_REPO` 或 `git rev-parse --show-toplevel`，不再写原型 `.data/`。
- 阶段门禁在服务端一处判定（`server/crew/gates.js`）：待验收状态 → 未答问题 → 交付型必须有本阶段证据 → 演示房间必须有 PASS。
- 实测（临时仓库 `/tmp/crew-s2-repo`）：未答题时 decision 阶段拒绝（409「还有问题没答」）；答题后可确认并推进；交付型无证据拒绝（409「还没有本阶段的证据，不能验收」）；有证据 + PASS 可确认；非演示房间三阶段确认完 → `CONCLUSION.md` 落盘 + 恰好一次本地 commit（`room: <name>`，不 push）。
- 诚实边界：演示房间的「模拟执行」只写 `simulated: true` 的样本证据并明确标注未真跑；真实命令执行器属 S3。基座无暂停/停止接口，实时房间的暂停只是本层停止转发，界面文案已如实说明。
- 结构（已完成）：业务全部在 `server/crew/`——`seats.js`（席位）、`store.js`（SQLite + transcript 追加写）、`seeds.js`（演示种子）、`digest.js`（调度摘要）、`gates.js`（阶段门禁）、`acceptance.js`（验收命令）、`room-repo.js`（仓库内产物与 commit）、`live.js`/`live-turns.js`（实时房间桥接与回合副作用）、`service.js`/`dispatch-service.js`/`demo.js`（业务用例）、`result.js`（语义结果）、`lock.js`（数据目录锁）；`server/index.js` 只做装配与 HTTP/SSE 传输。
- 引擎接口（`server/engine.js`，唯一端口）：`rooms()` 取房间、`history(sessionRef)` 取历史、`sendTurn({roomId,text})` 发一个回合、`cancelTurn({roomId})` 取消一个回合、`usage(roomId)` 取用量、`capabilities()` 声明能力、`subscribe({roomId,sessionRef,...})` 订阅事件。`Room` 只有 `id/name/sessionRef/goal/working/cwd/usage`；基座字段（`defaultResponder`、`threadId`、`botId/botName`、`usage.turns/costUsd`）只在适配层归一，crew 业务层看不到。
- 换 runtime 的条件已满足：实现上述端口即可替换基座，房间‑目标‑阶段‑证据这套业务与存储不动。`cancelTurn` 在基座不支持时返回 `{cancelled:false}` 并触发如实文案，不伪造「已停止」。
- 回归（2026-11-11，基座 8799 + 服务 8787 实跑）：门禁四种拒绝与放行、手工房间三次确认后 `complete` 且恰好一次本地 commit、实时房间暂停/暂停后发言/继续的文案全部符合预期。

## 8.3 S3 记录（2026-11-11）

- 真实引擎链路：基座（OpenMausBot，8799）+ Crew Server 跑通真实 CLI 回合；执行席位在基座群绑定的 `cwd` 里创建文件，回合 digest 与工具产物落成证据。
- 环境坑：基座若从 Claude 桌面会话继承 `CLAUDECODE=1` / `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`，子 CLI 一律 `Not logged in`。基座必须用干净环境启动（`env -i HOME PATH TMPDIR …`），驱动才会读取 `~/.claude/settings.json` 的 DeepSeek 路由。证据按真实厂商记录为 DeepSeek，不按 driver 名称记 Anthropic。
- 验收命令：`server/crew/acceptance.js` 在房间仓库执行 `/bin/sh -c <command>`，记录退出码、合并输出、`git` diff 与变更文件；diff 与提交范围排除 `.crew/`，避免房间运行记录混进交付内容。验收命令串行执行，超时杀整个进程组。
- 复核：`POST /api/rooms/:id/verify` 把验收证据发给验收席位，要求首行只写 `PASS`/`REJECT`；回复作为 `verdict` 落盘（`review:true`）。首版只有一台 CLI，复核与执行同引擎，界面标「独立性降级」，不冒充跨厂商。
- 签字与提交：`gateFor` 只认最新一条 verdict，且必须是 PASS；REJECT 后必须产生新证据才能再验收。人点「接受」后写 `CONCLUSION.md`（`decisions.md` 归人），再按「交付文件 + `.crew/rooms/<id>`」做一次本地 commit；提交后工作树保持干净。
- 复跑（临时仓库 + 全新基座群）：真实回合创建 `hello.txt` → 验收命令 exit 0、diff 含交付文件且不含 `.crew/` → 无 PASS 时签字被拒 → 验收席位独立重跑命令并 PASS → 人签字 → `complete`，commit 含交付文件与 `CONCLUSION.md`，工作树干净；`REJECT → 返工 → 新证据 → PASS` 链路也已实测。
- 演示房间：种子与交互只进 SQLite/SSE，不写目标仓库、不产生 commit；完成文案如实说明未写 `CONCLUSION.md`。
- 已知边界：无 worktree 隔离，提交范围是验收时仓库内的改动（不含 `.crew/`），按回合归属与并行隔离留到 M3；verdict 只存在房间库 / `transcript.jsonl`，尚未实现「从 transcript 重建运行时状态」；无审批桥（M4）；基座无取消接口，Stop 仍只是本层停止转发。
- UI：移除整包 vendored `ui/src/dsbot`，头像/主题/图标改为 `ui/src/marks.js`、`theme.js`、`icons.js`；消息气泡与 Markdown 样式收进 `ui/src/crew.css`，构建不再依赖 DS Bot 代码。优秀设计可以按模块复用，保留 Apache-2.0 许可/归属，不整包搬 DSH。

## 8.4 分层与契约核对（2026-11-11）

按「上游边界」四条硬规则逐条核对：

| 规则 | 现状 |
|---|---|
| 业务只写 `server/crew/` | 成立。`server/index.js` 只做组合与 HTTP/SSE；`server/base.js` 是传输客户端；`server/engine.js` 是语义适配层；crew 不 import 基座代码，也不返回 HTTP 状态码（用 `result.js` 的 `ok/created/accepted/fail`，由组合根映射）。上游 `crew-chat-base` 本次未改一行。 |
| 加厚 Engine 接口 | `server/engine.js` 是唯一端口：`rooms()` / `history(sessionRef)` / `sendTurn({roomId,text})` / `cancelTurn({roomId})` / `usage(roomId)` / `capabilities()` / `subscribe({roomId,sessionRef,...})`。`Room` 只有 `id/name/sessionRef/goal/working/cwd/usage`；group/thread/bot/defaultResponder 等基座词汇不再进入 crew。 |
| 冻结存储契约 | 房间产物按 `room.repoPath` 落到房间自己的仓库（不是全局 `CREW_REPO`）；`transcript.jsonl` 追加并 fsync 后再写 SQLite；`BRIEF.md` 只在不存在时生成初稿，之后运行时绝不改写；`GOAL.md`/`CONCLUSION.md` 是运行时投影；`decisions.md` 归人；`evidence/` 与 transcript 同目录。演示房间只进 SQLite/SSE。 |
| 保留替换路线 | 换 runtime 只需实现 Engine 端口，房间‑目标‑阶段‑证据与存储不动。SQLite 当前是 `room(id,payload)` / `messages(seq,id,room_id,payload)` 的原型索引，属于 `store.js` 内部实现，不是对外契约；迁移到 §11 关系表时只改 `store.js`。 |

**存储权威**：运行时状态在 SQLite（`store.js` 内部）；消息日志以 `transcript.jsonl` 为准（先写并 fsync）；意图以 `BRIEF.md` 为准（人）；`GOAL.md`/`CONCLUSION.md` 是运行时投影；证据是 `evidence/<messageId>.json`。

**已修掉的越界点**：`CREW_BASE_GROUP` → `CREW_ROOM`；`participants()/threadId/botId/botName` → `rooms()/sessionRef`；`service.js` 不再返回 HTTP status；`live.js` 拆为 `live.js` + `live-turns.js`；`dispatch-service.js`、`demo.js`、`acceptance.js`、`lock.js` 各自单一职责；server 按职责分层，不设行数上限（见 `设计思想.md` §9）。

**仍待处理**：`ui/src/app.js` 仍是单文件页面（行数不是约束；后续按视图拆分只为可维护性）；`templates/delivery-triad.crew.yaml` 尚未接导入（M0 判据之一）；Engine 端口是房间级语义（设计 §10.5 已同步为实际端口）；`start/resume` 流式端口是后续目标，真实回合仍由基座 runtime 驱动。

### 8.5 P0 记录（2026-11-11）

- **底座加固**：`room` 表加 `version`，房间状态变更统一走 `updateRoom` 的 IMMEDIATE 事务；新增 append-only `room_event`（建房/阶段/验收/复核/提交/迁移）；席位能力（read/exec/write、writeScope、toolSurface）成为单一事实来源，启动时校验，声明不合法直接失败；新增 `/api/health`；`npm test` 覆盖门禁、验收命令、store 事务与席位契约。
- **房间投影（2026-11-12）**：`/api/state` 与所有房间事件共用 `presentRoom`，统一附带 `needsYou`、`independenceLabel`、`independencePolicy`；UI 的状态条与高级面板直接消费这些字段，不再自己重算阶段/证据/verdict 状态和独立性文案。`presentation.test.js` 覆盖投影不修改存储房间。UI 仍保留 per-seat 展示状态（working/done）与阶段选择，这是展示层，不参与业务判定。
- **结果三态（2026-11-12）**：业务拒绝用 `fail` 映射 4xx；系统/基座/IO/工作区异常直接抛到组合根映射 500，不再用 `fail('conflict')` 包装。复核请求的业务条件用 `BusinessError` 区分，`service.verify` 只把这类错误转成 4xx；开工卡队长不可用、建房中途创建 bot/群失败会显式 500。
- **真实三人组（模板验证）**：从界面建房 → Engine 端口在基座创建三个 bot（同引擎，明确标「独立性降级」）+ 一个群 + 一个房间仓库；队长提示词要求 ≤3 问对齐（未强制）；人确认后系统 @执行；执行回合后自动跑验收命令；验收席位独立复跑并给 PASS/REJECT；人签字 → `CONCLUSION.md` + 一次本地 commit。
- **开工卡（2026-11-11）**：建房前由队长读目标与仓库事实，给出一张开工卡：done、席位/职责/理由、验收方式、最多 3 个带推荐答案的问题；业务用 `validateRoster` 校验，UI 展示 done/问题/编制/验收，人确认一次直接开工，不再二次对齐；答案与 done 写进 BRIEF，手动模板只作覆盖。真实小目标验证：队长建议 1 个执行席位而不是三人组，约 7–8 秒返回；按卡建房没有对齐阶段，worker 直接开工，BRIEF 含 done 与编制理由，跑通到人签字与 commit；临时队长线程/工作区已清理。manual 开工卡也验证：产物就绪后生成 manual 证据，`needsYou=等你验收`，人签字后结论 commit。边界：建后改席位未接；角色仍限队长/执行/验收；多验收未接；基座不可用或建议不可解析时显式回退“手动选编制”，不静默套模板；建议只读，用户目录不是 git 仓库时显式失败，不在用户目录里 git init。
- **模板驱动与按需编制**：席位是数据，三人组和单人只是模板；建房可传 `seats: [{ role, name }]` 自定义编制，服务端只接受 `lead / worker / verifier`，权限由角色派生（自定义不能自己发明能力）。约束：至少一个 worker，最多一个 lead、一个 verifier；多执行可并行，多验收未接（fail closed）。无 `lead` 时跳过对齐，直接进入交付；无 `verifier` 时门禁按席位表判断，真实证据 + 人签字即可通过；有 verifier 或席位表未知时仍必须拿到 PASS。已用真实 CLI 跑通单人全链路：执行 → 验收命令 exit 0 → 人签字 → `CONCLUSION.md` → 本地 commit，工作树干净。
- **首屏**：默认不 seed 演示房和调度假请求；空状态只有一个「开一个房间」；对齐/派活/复核提示只进基座线程，不进 Crew 时间线。
- **注意力路由**：`attention.js` 从房间状态派生 `needsYou`（待确认/待回答/待签字/待复核/退回/待设命令）；侧栏显示一个点与「N 个等你」，调度摘要同步；不为每条消息做未读。
- **能力扩展缝**：席位声明 `skills / mcp / approval`，启动时校验；crew 只传 `approval / mcp` 语义，`approvalMode / mcpServers` 的映射只在 `engine.js`（实测 soul 与 approvalMode 生效）；MCP 默认关闭，planner/verifier 不放外部工具；技能只存引用，`capabilities.skills=false` 时建房 fail closed。`boundary.test.js` 会拦住 crew 里的基座词汇，`store.test.js` 覆盖旧 schema 的增量迁移。
- **触发扩展缝**：定时/事件任务归基座 routines/webhooks，crew 只存 `triggers` 引用与授权，不写 cron 循环；当前未接，`capabilities.schedules=false`，默认关闭；主动档位等真实后台检查与审批跑通后再开。
- **调度台**：仍是只读前台——收件、建议、一次确认、投影摘要；不做能操作界面的全局助手。若要加，只能是 read + propose（解释、打开面板、生成草稿），最终动作由用户点。
- **真实 M3 验证（2026-11-11）**：用临时源仓库 + 全新数据目录跑通三人组：3 个基座线程、3 个工作区、executor 分支正确；planner 克隆没有 `hello.txt`；executor 在自己的 worktree 创建文件，源仓库 `main` 仍干净；候选 commit 在 `crew/<room>/executor`；verifier 临时副本拿到候选文件并给 PASS；人签字后 executor 工作树干净，结论 commit 含 `CONCLUSION.md`；交付在房间分支上，可人工合并。另验证两席自定义房（执行+验收）与无验收房（队长+执行，`human` 人签字）；测试 bot 与群已清理，基座回到只有 MausBot。
- **并行执行（2026-11-11）**：自定义编制可含多个执行席位；每个执行独立 worktree/分支，同一交付阶段并行派发。全部执行回合结束后，按顺序把候选分支合并进房间集成 worktree（`crew/<room>/integration`），在集成目录跑验收命令，再交验收席位复核。合并冲突会回滚并停下等人（`needsYou.kind=merge`）；15 分钟未完成报超时（`kind=parallel`）。真实双执行验证：前端/后端各自 worktree + 候选 commit，集成合并、验收 exit 0、verifier PASS、人签字、`CONCLUSION.md` + 结论 commit；源仓库 `main` 干净，交付在 integration 分支，候选分支保留供人工查看。单元测试覆盖集成 worktree、合并、冲突回滚。
- **下一步（设计文档 §15.1）**：P0 是 worktree 生命周期（依赖/`.env`/端口/自动清理/磁盘水位）与成本/磁盘闸门；P1 是业务感知交接包、工作区级项目约束、子任务依赖图/阶段级部分成功、MCP 隔离与审计、复盘/用量视图、调度台只读资源面板、本地模板导入。明确不做：模板市场、多人协作/Org、非编码模式、自动执行、第二个有写权限的全局助手、黑盒 RAG。
- **已知边界**：UI `app.js` 是单文件页面，后续可按视图拆分；模板导入未接；Engine 端口是房间级语义；M1 游标/轮次/空转已落，交接包未做（实际增量由基座 delta-context 负责）；M2 真 Stop 已接（未做 500ms E2E），@ 基础有；M3 席位隔离与并行 executor worktree 已落（planner 克隆 / 多 executor worktree / 集成 worktree / verifier 临时副本 + 候选提交）；工具级权限强制未做；建后改席位未接；多验收席位未接；manual 验收不挂 verifier（要独立复核必须补命令，fail closed）；并行合并冲突需要人处理，没有自动重排；verifier 与执行同引擎、同群，真正独立监督在 M4；编制建议依赖基座可用，失败时显式回退手动选编制；Goal 仍是两段、goal-grill 未强制；跨厂商盲审/审批桥/发言预算/fork 未做；Electron 未接，TypeScript 只在基座；SQLite 仍是原型索引，关系表迁移只改 `store.js`。

## 9. 许可与合规

- OpenMausBot：Apache-2.0；保留根 `LICENSE`、`NOTICE` 与源文件头。`enterprise/` 是单独的商业许可，删除。
- Claude-Bot / DS Bot：Apache-2.0；优秀设计与代码可复用，保留 LICENSE、NOTICE 与文件头；不复制 enterprise/商业代码，不引入 DSH 宿主/插件/store 耦合。
- 商标：OpenMausBot / MausBot 名称与吉祥物是商标，Apache-2.0 不授予商标权；产品名用 Crew Chat，换掉一切上游品牌资产。
- 我们自己的仓库补 `LICENSE` 与 `NOTICE`（如包含上游代码）。

## 10. 风险

1. **基座太大**：删除产品面的工作量可能超过预期。Spike 先证明 UI 与宿主可替换，再全量迁移。
2. **上游演进**：driver 接口可能变。产品代码集中在 `server/crew/` 与 `ui/`，减少冲突面。
3. **状态双写**：房间消息日志以 `transcript.jsonl` 为权威（先追加并 fsync）；SQLite/`room_event` 是运行时状态、索引与 trace。索引可重建，不用 SQLite 反向覆盖 transcript。
4. **权限语义**：席位权限表要映射到 ACP 的 `session/request_permission` 与 approval mode，不要把「只读」当成安全边界。
5. **Node 版本**：基座要求 Node ≥24（strip-types）；Mac arm64 用 24 LTS，CLI 路径按 `/opt/homebrew/bin` 探测。
