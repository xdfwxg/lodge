# 复用地图 v2.0

> 2026-11-11 · 目标：用成熟、可扩展的运行时做地基，Lodge 只写产品差异层。
> 原则：**复用运行时，替换产品面；抄代码，不抄产品。**
>
> 分层与取舍判断见根目录 [`设计思想.md`](../设计思想.md)。
>
> **当前实现（2026-11-12）**：P0+ / M3 部分 / M4 审批桥部分。设计目标是 `docs/lodge-design.md`；规则见 `设计思想.md`；§8.5 是唯一的状态入口。已成立：开工卡（done/编制/验收/≤3 问，一次确认）、席位按需组合、多执行并行、多验收席位（全部 PASS 才签字）、建后加执行/验收席位、manual 人验收、worktree 生命周期（环境同步/端口提示/清理/GC/磁盘水位）、席位引擎绑定（可用 instance/model；不可用显式降级）、验收命令一次性副本、网络 isolator（macOS sandbox-exec / Linux unshare；Windows 走 WSL2 + bubblewrap，缺原语 fail closed）、工具审批桥（写工具按席位拒绝；外部动作先挂起，独立守门给建议后由人批准；exec 仍不是通用文件系统沙箱）、验收盲审与无显式引擎时的跨厂商偏好、完成态交付单（目标/阶段/命令/文件/结论/commit）与 Markdown 导出、资源面板最近交付、有队长时的“对齐 → 交付 → 验收与结论”三段式和最多 3 个工作阶段、从完成房间续做/分叉、调度台本地词项路由、成本硬闸门（房间/全局预算到线暂停新任务，调度台只展示）、本地交接包（真实房间导出 JSON 包，另一个实例只读导入并基于 BRIEF 续做新房间）、Workspace 端口（git 与普通目录两种 provider，非 git 目录复制隔离、文件清单、无 commit）、目标岛三问摘要与返工记录、复盘视图（成本/Token/返工/失败派生）、席位交接包（业务素材 + transcript 引用）、项目约束 `LODGE.md`（建房快照）、本地模板导入（YAML/JSON）、阶段依赖与部分成功、调度台只读资源面板、MCP 调用审计与按 server 熔断、用量时间序列页、约束分层、目标任务模型与历史目标。未接：runtime Assignment、Windows 真机 dogfood（WSL2 + bubblewrap 适配器已有，但未在 Windows 上实跑）、建后移除/改角色、独立模型守门 agent、M4 独立复核会话、无第二引擎时的稳定跨厂商、阶段可视化编辑与分叉会议、跨实例交付汇总、模型语义路由、模板持久化库、Electron。

## 0. 选型结论

| 角色 | 选择 | 理由 |
|---|---|---|
| 基座 | **OpenMausBot OSS**（Apache-2.0） | 引擎驱动、Assignment 运行时、SQLite/SSE、Electron 壳都已成熟，且靠 driver/ACP 扩展 |
| 引擎 | **OpenMausBot drivers** | 原生 Claude/Codex 驱动 + ACP；新增 CLI 是加 driver 或一条配置，核心不动 |
| UI 参考 | **Claude-Bot / DS Bot**（Apache-2.0） | 优秀设计可复用（含代码/CSS）；保留 LICENSE、NOTICE 与文件头；不引入 DSH 宿主/插件/store 耦合；当前 UI 自写 |
| 产品层 | **Lodge 自写** | 房间即仓库、阶段验收、证据、跨厂商独立性、席位模板 |

明确不采用：LangGraph / CrewAI / AutoGen 这类编排框架；也不自写 CLI spawn 层。前者多一层状态真相，后者会重造 OpenMausBot 已经做对的引擎管理。

当前 spike 是独立基座仓库 `crew-chat-base`（8799），通过 HTTP 接入；还不是单体 fork，Electron 打包待 S5。

### 基座形态：推荐 A，备选 B

**A（推荐）以 OpenMausBot OSS 为基座 fork**
- 删 `enterprise/`，保留 `server/runtime`、`server/drivers`、`server/engine-*`、Electron 壳。
- 新增 `server/crew/`（房间、阶段、证据）与 Lodge UI；当前 `ui/` 整体迁入。
- 保留 `upstream` remote，引擎更新按 driver 粒度 cherry-pick。
- 代价：仓库大（约 7,660 个文件、1,565 个 server TS 文件），产品面要删；收益：引擎/认证/安装/更新全部现成，且持续可跟上游。

**B 在 Lodge 里按模块移植**
- 只搬 `runtime` + 选中的 driver。实测 `claude.ts` 与 `acp/core.ts` 各 44 条 import，牵扯 config、procs、auth、catalog、engine home 等一整片；搬完等于维护一个私有分叉，且拿不到上游更新。
- 仅在 A 的删除成本被证明不可控时启用。

**两天 spike 判据**：基座能启动、我们的 UI 能接上、一个房间能跑一次真实 Claude turn、证据落盘。不满足再转 B。

## 1. 分层与扩展点

```
┌ UI（Lodge 自己的视觉与状态层）──────────────┐
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
| `src/components/{ApprovalCard,QuestionCard,AskCard}.tsx` | 审批/提问卡交互 | 只借状态机；样式按 Lodge CSS 重写，不引 Tailwind |

## 3. OpenMausBot：适配后复用

| 模块 | 改动 | 风险 |
|---|---|---|
| `server/runtime/types.ts` 的 `Assignee` / `Destination` | `botId` → 席位 id；`thread` → Room thread | 改动会扩散到 store 校验，先写适配层，不直接改类型 |
| `server/group-goal-run.ts` | 协调循环保留；阶段推进改由 `server/crew/stages` 判定 | 它的完成判定是模型输出，不能替代人的签字 |
| `src/state/store.tsx`（约 3,300 行） | **不复用**；Lodge 现有 store 接 `thread-events` | 它绑 bot-as-person 概念与整套页面 |
| `src/components/*` 的引擎设置页 | 可作为「高级」面板参考 | 状态与 wire 耦合深，首版只做最小设置 |
| `server/openmausbot.ts` 宿主装配 | 换成 Lodge 宿主，只装 runtime + 选中 driver + crew 模块 | 宿主入口虽短，装配面很宽；按能力逐项打开 |

## 4. Claude-Bot / DS Bot：优秀设计可复用，保留许可与归属

| 资产 | 结论 | 说明 |
|---|---|---|
| 侧栏、气泡、输入框、折叠卡、@ 菜单的视觉与交互 | **已吸收** | 当前 `ui/src/crew.css` 与组件即由此演进，不再二次搬代码 |
| `ds-bot/src/client/*` | **按模块复用** | 是 DSH 插件 UI，import `@deepseek-ai/dsh-client-*`；只取不依赖 DSH 的部分，保留许可/归属，不整包搬 |
| `app/ui`（休眠的独立 UI 分支） | **不搬** | 只服务单 bot，不服务群；群聊由 DSH 壳渲染 |
| `ds-bot/src/host/local-agents/*` | **不搬** | OpenMausBot 的原生驱动与 ACP 更完整（认证、安装、版本门禁） |
| `ds-bot/src/host/goals.js` | **设计参考** | 状态与证据门禁可看；`pass` 只校验证据非空，不执行命令 |
| `ds-bot/src/client/goal.js`（目标岛） | **照设计重写** | 目标岛布局、阶段步进器、任务行、状态语言直接采纳（§9.7）；代码绑 `BotMark`/`i18n`/DSH 样式，不搬组件，按 Lodge CSS 重写 |
| `ds-bot/src/host/skills/goal-grill/SKILL.md` | **照设计重写** | 只参考对齐流程；不直接复制技能正文。队长提示词由 Lodge 自写 |
| `app/src/main.mjs` 的 Electron 结构 | **不搬** | OpenMausBot 的壳更完整；只参考窗口/权限细节 |

已实测的坑，继续有效：

1. 不要 import `ds-bot/src/client/sidebar.js`：会引出 `deep-view/*` 与整张 DSH 依赖图。视觉与 CSS 可以复用优秀设计，但保留许可/归属，不要把 DSH 依赖带进来。
2. 组件是 `createElement` 写法，不要顺手改成 TSX，否则 diff 失控。
3. `app/ui` 的 `useChat` 在 `botId === undefined` 时直接返回，房间时间线必须自己写。
4. 两套样式系统不能混：不为了三张卡引入 Tailwind。

## 5. Lodge 自己写

1. **房间即仓库**：`BRIEF.md`（人）、`GOAL.md`/`CONCLUSION.md`（运行时投影）、`transcript.jsonl`、`evidence/`，完成时一次本地 commit，不 push；`decisions.md` 归人，运行时不写。
2. **阶段与门禁**：`decision` 阶段要人点；`deliverable` 阶段要验收命令 + Verifier PASS；`openQuestion` 未答不能确认。
3. **验收执行器**：一次性副本、超时、环境变量白名单、退出码与产物哈希；明确「协作隔离，不是安全边界」。
4. **跨厂商独立性**：`vendor | model | none`，降级在验收卡上标注；盲审与同厂商复核提示。
5. **席位模板与权限**：Planner 只读、Executor worktree 写、Verifier 只读；模板可换，不改核心。
6. **产品 UI**：当前 `ui/` 的房间、调度台、证据回执、完成态；状态层接基座事件。
7. **调度台**：一句话 → 建议交给哪个群；接 OpenMausBot 的请求/建议形态，不重造。
8. **Lodge 宿主装配**：只装 runtime + 首版 driver + crew 模块，不把 OpenMausBot 的全部能力都打开。

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
  ui/                         # 当前 Lodge UI 迁入
  electron/                   # 复用，换品牌与入口
  templates/                  # 席位模板
  docs/
    lodge-design.md
    reuse-map.md
```

## 8. 拼装顺序

| 步 | 做什么 | 判据 |
|---|---|---|
| S0 | fork OSS，删 `enterprise/`，跑通 `pnpm dev` 与现有测试 | 基座能启动，`edition: oss` |
| S1 | 迁入 Lodge UI，接 `thread-events`/SSE，一个房间显示历史 | 关掉重开一致 |
| S2 | `server/crew/`：BRIEF、transcript、evidence、阶段门禁；接 runtime Assignment | 一个 decision 阶段由人确认，一个 deliverable 阶段有证据 |
| S3 | 接真实 Claude Code（原生 driver），跑一条完整链路 | 命令退出码、输出、diff 入 evidence，Verifier 复核，人签字，commit |
| S4 | 接 Codex 或第二个 ACP 引擎，打开跨厂商独立性 | 验收卡显示 `vendor`，降级时显示 `none` |
| S5 | Electron 打包（arm64），签名与自动更新 | Mac M 芯片可安装、可更新 |

**进度（2026-11-11）**：S0 通过。S1 以「原型独立运行 + 适配层」的方式走通：基座群映射为实时房间，历史消息、实时 `activity`、`msg.patch` 与重连均可用；尚未把 UI 源码迁进基座。S2 已走通（见 §8.1、§8.2），业务层按「上游边界」规则收进 `server/crew/`，基座差异只出现在 `server/base.js`（传输）与 `server/engine.js`（语义适配）。S3 已走通（见 §8.3）：真实 CLI 回合 → 房间仓库执行验收命令 → 退出码/输出/diff 落证据 → 验收席位复核 PASS → 人签字 → 一次本地 commit。未接 runtime Assignment，也没有引入上游编排层。

## 8.1 Spike 记录（2026-11-11）

> 下面 S1/S2 里的 `.data/rooms/...` 是历史 spike 路径；当前产物在房间仓库的 `.crew/rooms/<id>/`。

- 基座：`crew-chat-base`，`8799`，`edition: oss`；`enterprise/` 已删，上游 remote 保留。
- 适配层：`server/base.js` 读 `GET /api/bots?messages=0`、`GET /api/threads/{id}/messages`、订阅 `/api/events`、`POST /api/groups/{id}/messages`。
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

- 真实引擎链路：基座（OpenMausBot，8799）+ Lodge server 跑通真实 CLI 回合；执行席位在基座群绑定的 `cwd` 里创建文件，回合 digest 与工具产物落成证据。
- 环境坑：基座若从 Claude 桌面会话继承 `CLAUDECODE=1` / `CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST=1`，子 CLI 一律 `Not logged in`。基座必须用干净环境启动（`env -i HOME PATH TMPDIR …`），驱动才会读取 `~/.claude/settings.json` 的 DeepSeek 路由。证据按真实厂商记录为 DeepSeek，不按 driver 名称记 Anthropic。
- 验收命令：`server/crew/acceptance.js` 在房间仓库执行 `/bin/sh -c <command>`，记录退出码、合并输出、`git` diff 与变更文件；验收 diff 与候选提交排除 `.crew/`，避免房间运行记录混进交付内容；完成时的结论 commit 会单独带上 `.crew/rooms/<id>/`，让房间记录随分支走。验收命令串行执行，超时杀整个进程组。
- 复核：`POST /api/rooms/:id/verify` 把验收证据发给验收席位，要求首行只写 `PASS`/`REJECT`；回复作为 `verdict` 落盘（`review:true`）。首版只有一台 CLI，复核与执行同引擎，界面标「独立性降级」，不冒充跨厂商。
- 签字与提交：`gateFor` 只认最新一条 verdict，且必须是 PASS；REJECT 后必须产生新证据才能再验收。人点「接受」后写 `CONCLUSION.md`（`decisions.md` 归人），再按「交付文件 + `.crew/rooms/<id>`」做一次本地 commit；提交后工作树保持干净。
- 复跑（临时仓库 + 全新基座群）：真实回合创建 `hello.txt` → 验收命令 exit 0、diff 含交付文件且不含 `.crew/` → 无 PASS 时签字被拒 → 验收席位独立重跑命令并 PASS → 人签字 → `complete`，commit 含交付文件与 `CONCLUSION.md`，工作树干净；`REJECT → 返工 → 新证据 → PASS` 链路也已实测。
- 演示房间：种子与交互只进 SQLite/SSE，不写目标仓库、不产生 commit；完成文案如实说明未写 `CONCLUSION.md`。
- 已知边界（S3 当时，后续已被 §8.5 覆盖）：无 worktree 隔离，提交范围是验收时仓库内的改动（不含 `.crew/`）；verdict 只存在房间库 / `transcript.jsonl`，尚未实现「从 transcript 重建运行时状态」；无审批桥（M4）；Stop 当时只是本层停止转发。M3 已落 worktree 隔离、并行集成、清理/GC 与真 Stop。
- UI：移除整包 vendored `ui/src/dsbot`，头像/主题/图标改为 `ui/src/marks.js`、`theme.js`、`icons.js`；消息气泡与 Markdown 样式收进 `ui/src/crew.css`，构建不再依赖 DS Bot 代码。优秀设计可以按模块复用，保留 Apache-2.0 许可/归属，不整包搬 DSH。

## 8.4 分层与契约核对（2026-11-11）

按「上游边界」四条硬规则逐条核对：

| 规则 | 现状 |
|---|---|
| 业务只写 `server/crew/` | 成立。`server/index.js` 只做组合与 HTTP/SSE；`server/base.js` 是传输客户端；`server/engine.js` 是语义适配层；crew 不 import 基座代码，也不返回 HTTP 状态码（用 `result.js` 的 `ok/created/accepted/fail`，由组合根映射）。上游 `crew-chat-base` 本次未改一行。 |
| 加厚 Engine 接口 | `server/engine.js` 是唯一端口：`rooms()` / `history(sessionRef)` / `sendTurn({roomId,text})` / `cancelTurn({roomId})` / `usage(roomId)` / `capabilities()` / `subscribe({roomId,sessionRef,...})`。`Room` 只有 `id/name/sessionRef/goal/working/cwd/usage`；group/thread/bot/defaultResponder 等基座词汇不再进入 crew。 |
| 冻结存储契约 | 房间产物按 `room.repoPath` 落到房间自己的仓库（不是全局 `CREW_REPO`）；`transcript.jsonl` 追加并 fsync 后再写 SQLite；`BRIEF.md` 只在不存在时生成初稿，之后运行时绝不改写；`GOAL.md`/`CONCLUSION.md` 是运行时投影；`decisions.md` 归人；`evidence/` 与 transcript 同目录。演示房间只进 SQLite/SSE。 |
| 保留替换路线 | 换 runtime 只需实现 Engine 端口，房间‑目标‑阶段‑证据与存储不动。SQLite 当前是 `room(id,payload)` / `messages(seq,id,room_id,payload)` 的原型索引，属于 `store.js` 内部实现，不是对外契约；迁移到 §11 关系表时只改 `store.js`。 |

**存储权威**：运行时状态在 SQLite（`store.js` 内部）；消息日志以 `transcript.jsonl` 为准（先写并 fsync）；意图以 `BRIEF.md` 为准（人）；SQLite 的 done/constraints 解析缓存（含 `source_hash`）是设计裁定，代码未接，当前仍以房间 JSON + BRIEF 为准；`GOAL.md`/`CONCLUSION.md` 是运行时投影；证据是 `evidence/<messageId>.json`；治理事件是 append-only 的 `events.jsonl`，SQLite `room_event` 是查询索引。

**已修掉的越界点**：`CREW_BASE_GROUP` → `CREW_ROOM`；`participants()/threadId/botId/botName` → `rooms()/sessionRef`；`service.js` 不再返回 HTTP status；`live.js` 拆为 `live.js` + `live-turns.js`；`dispatch-service.js`、`demo.js`、`acceptance.js`、`lock.js` 各自单一职责；server 按职责分层，不设行数上限（见 `设计思想.md` §9）。

**仍待处理**：`ui/src/app.js` 仍是单文件页面（行数不是约束；后续按视图拆分只为可维护性）；本地模板导入已接，但没有模板持久化库/市场；Engine 端口是房间级语义（设计 §10.5 已同步为实际端口）；`start/resume` 流式端口是后续目标，真实回合仍由基座 runtime 驱动。

### 8.5 P0 记录（2026-11-11）

- **底座加固**：`room` 表加 `version`，房间状态变更统一走 `updateRoom` 的 IMMEDIATE 事务；新增 append-only `room_event`（建房/阶段/验收/复核/提交/迁移）；席位能力（read/exec/write、writeScope、toolSurface）成为单一事实来源，启动时校验，声明不合法直接失败；新增 `/api/health`；`npm test` 覆盖门禁、验收命令、store 事务与席位契约。
- **worktree 生命周期（2026-11-12）**：创建时为 worker/verifier/integration 复制 `.env`/`.env.local`、软链 `node_modules`；给执行/验收/集成目录分配端口，并在工作提示词与验收命令里注入 `PORT`。候选 commit 与验收 diff 排除 `.env`/`.env.local`/`node_modules`/`.crew`。房间完成/停止后清掉非交付席位工作区（保留交付仓库与候选分支）；启动与每 6 小时 GC 已知房间；未知孤儿目录默认不删，`CREW_WORKTREE_GC_ORPHANS=1` 才按 TTL（默认 7 天）清理；创建前做磁盘水位检查（默认 512MB）。真实验证：`.env` 与依赖软链到位，候选 commit 只含交付文件，完成后 planner/verifier 工作区被清理、executor 交付仓库与分支保留，结论 commit 不含 `.env`。边界：`node_modules` 是共享软链，不适合在工作区里改依赖；Python venv/本地数据库/端口强制隔离未做；端口是提示与验收注入，应用不认 `PORT` 时仍需人处理。
- **成本硬闸门（2026-11-12）**：新房间默认 $5 预算（`CREW_ROOM_BUDGET_USD` 可改）；`CREW_GLOBAL_BUDGET_USD` 可选全局上限，0 都表示不限。预算数据来自基座 `usage.costMicroUsd` 的席位汇总，不信任模型自报。到线把房间置 `paused`（`pauseReason='budget'`），只拦新回合、新阶段和新房间，不取消正在跑的回合；调度台/侧栏只展示，不获得控制权。`POST /api/rooms/:id/budget` 可调房间预算，提高后自动恢复；若当前阶段还没有证据，会续跑该阶段。验收/复核/消息在发回合前检查房间与全局预算，超限返回 4xx 业务拒绝。真实 E2E：房间预算 $0.001 时首回合 $0.073 后暂停并出现 `needsYou.kind=budget`，调高到 $2 后恢复；全局预算 $0.001 时首回合 $0.081 后暂停，新建房间返回 409；页面侧栏显示 $0.081 / $0.001，高级里的预算输入能把 $6 保存到服务端。边界：全局上限只统计 Lodge 房间，开工卡推荐用的临时队长回合不计入；成本是基座按模型目录价上报的估算值，本机 CLI 实际走 DeepSeek 时可能不等于真实账单，闸门只保证按上报值截止，不能当计费凭证；发言配额仍未强制。
- **语义评测 harness（2026-11-12）**：`npm run eval:planning` 用 3 个黄金房间（solo-cli / api-rate-limit / parallel-settings）调用真实 `recommendRoster`，runner 把 fixture 复制到临时 git 仓库，评分器检查 done 可核对、席位约束、角色名与 `why` 一致、验收命令、parser 截断、问题 ≤3 且不问机制。结果写 `evals/planning/results/latest.{json,md}`，不提交；不进入 `npm test`；任一 case 失败时命令非零退出。首轮 3 case × 3 次 9/9；并行 case 曾因 fixture 过小被判单人，扩成前后端各自有实质工作后通过；rubric 也收紧过一次，避免把“无需验收”的 `why` 误判为缺 verifier。
- **席位引擎绑定（2026-11-12）**：`createSeatBot` 接收 `seat.engine`，`engine.js` 把 `claude-cli/codex-cli/grok-cli` 映射到基座 driverKind，再查 `/api/instances`，选择可用 instance/model。不可用时显式回退默认模型，房间记录 `engineFallbacks` 并写「引擎降级」消息；实际引擎写入 `room.engines`，UI 不显示请求的假引擎；`/api/state.engines` 暴露 available/原因/默认模型/capabilities，Advanced 只读显示，不做引擎选择器。当前机器只有 `claude` 可用，Codex/Grok 会降级；能力矩阵参与策略仍未接。
- **验收命令隔离（2026-11-12）**：`live-turns.js` 先 `commitCandidate`，再在 `createAcceptanceCopy` 创建的一次性 detached worktree 里跑验收命令；diff 在候选提交前采集，所以 evidence 仍记录交付改动。副本同步 `.env` 并软链 `node_modules`，跑完即删。真实房间验证：验收命令在副本里写 `acceptance-side.txt`，交付 worktree 没有该文件，evidence 的 `files` 只有交付文件，并带 `isolated: true` 与 `commandCwd`。边界：只隔离交付目录写入；网络默认 deny（macOS `sandbox-exec` / Linux `unshare -n`；Windows 走 WSL2 + bubblewrap，同时把根挂成只读、只允许副本目录和临时目录写入；`CREW_ACCEPTANCE_NETWORK=allow` 可显式放行）。没有 WSL2 或 bubblewrap 时 Windows fail closed；macOS/Linux 的网络隔离不限制文件写入；worker 自己跑测试产生的 side effect 仍在自己的 worktree。Windows 适配器有注入式单测，尚未在 Windows 真机实跑。
- **工具审批桥（2026-11-12）**：基座的权限卡经 `engine.js` 映射为 `read/exec/write`（`actionForTool`），`live.js` 按 `seatSpecs.permissions` 对普通工具自动 allow/deny，经 `/api/threads/:id/respond` 回答。planner/verifier 改为 `approval:'ask'`；planner/verifier 的 Write/Edit/MultiEdit 被拒绝，Bash 对 verifier 放行。真实房间验证：队长请求 Write，系统写「权限拒绝：队长 不能使用 Write」，`forbidden.txt` 未创建。**外部动作审批桥**：`external-actions.js` 识别 push/publish、安装依赖、删除、对外发送、提权、网络/远端命令；命中后不再自动放行，而是写 `room.approvals` 待批准记录并挂起基座权限卡，`needsYou.kind=approval`，时间线出现允许/拒绝卡片；`POST /api/rooms/:id/approvals` 由人决定后才回答基座。暂停、停止、断绑或服务重启会把待批准记录标为 `expired`，避免留下永远点不动的按钮。单测覆盖挂起、允许、拒绝、内部命令自动放行、失效。边界：分类器按命令语义匹配，不是完备的 shell 解析；未知工具仍 fail closed；exec 仍可在临时副本里写文件，不是通用文件系统沙箱；M4 独立复核会话与跨厂商盲审未做。
- **多验收席位（2026-11-12）**：`verifiers.js` 只看最新一条验收命令证据上的结论（最新命令失败会让旧 PASS 全部作废）；`live-turns.js` 把复核请求发给每个验收席位，全部 PASS 才结束复核；任一 REJECT 立即打回并取消其余等待中的请求（其迟到回合并入后按非执行回合忽略）。`gates.js` 在 2+ 验收席位时要求本轮每个席位都有 PASS，任一未回报或打回都拒绝签字；`attention.js`/目标岛显示已回报数量与合并 verdict，旧轮 PASS 不算新证据。单验收与无验收路径保持原行为。UI 自定义编制可添加/移除验收席位。边界：多验收仍共用同一引擎与群，独立性只是“各自复核”，跨厂商盲审未做；复核超时只影响该席位，需人再次发起或等后续证据。
- **完成态交付单（2026-11-12）**：`delivery.js` 从房间与消息派生目标、通过阶段、每条命令与退出码、改动文件、验收结论、独立性与 commit；`presentation.js` 只在 `state=complete` 时挂 `delivery`，不新增真相源；`ui/src/delivery-sheet.js` 在完成房间顶部先展示交付单，聊天退到下方。`completeRoom` 记录 `completedAt` 与 git HEAD，plain 工作区不伪造 commit。单测覆盖投影与组件渲染；未做交付单导出与跨房间汇总。
- **独立守门建议（2026-11-12）**：外部动作挂起时，`gate.js` 只看命令语义、席位角色与房间约束（不读执行席位对话），给出 `allow/review/deny` 建议和理由，随审批记录展示；最终仍由人点允许/拒绝。它挡提权、破坏性删除、强制改写历史，以及 lead/verifier 的外部写入；房间约束里的“不 push/不联网/不安装依赖”会直接建议拒绝。边界：这是规则型独立检查，不是独立模型 agent，也不是跨厂商守门。
- **Goal 三段式（2026-11-12）**：有队长的房间落“目标对齐 → 交付 → 验收与结论”三段；开工卡确认后对齐段标为已过，交付段进行中，验收段等交付通过后由人确认。没有队长的房间跳过对齐，保留“交付 → 验收与结论”。开工卡超过 3 个问题直接返回 4xx，不再静默截断；`roster-recommend` 允许多个验收席位。边界：开工卡可声明最多 3 个工作阶段（总 3–5 段），但还没有可视化阶段编辑器；自由聊天里没有强门禁；分叉会议未做。
- **建后加席位（2026-11-12）**：`workspace-git.addSeat` / `workspace-plain.addSeat` 只创建新增席位的工作区；`service.addSeat` 创建基座席位线程、更新 seatSpecs/members/workers/verifiers/seatRooms/seatBots/engines/worktrees/ports/seatCursors，再让 `live.attachSeat` 同步历史并订阅。无显式引擎的验收席位优先选不同厂商；失败时回滚基座线程。区间：加执行/验收席位；移除和改角色未做。UI 在高级面板提供“建后加席位”。
- **盲审与跨厂商偏好（2026-11-12）**：验收提示明确“只看目标、约束、证据和改动，不读取执行席位对话”；verdict 记录 `blind: true`，时间线标“盲审”。建房/加席位时无显式引擎的验收席位优先绑定不同厂商 instance；没有第二可用引擎时仍显式降级，不宣称稳定跨厂商。
- **多阶段拆解与续做（2026-11-12）**：开工卡可声明最多 3 个工作阶段（每个交付阶段必须有验收命令），加对齐和“验收与结论”共 3–5 段；`createRealRoom` 按声明建阶段。已完成房间也能作为 `continueFrom` 起点，继承 BRIEF done 续做/分叉。边界：阶段可视化编辑、分叉会议未做。
- **交付单导出与最近交付（2026-11-12）**：`deliveryMarkdown` 导出目标/阶段/命令/文件/结论/commit；`GET /api/rooms/:id/delivery/export`；资源面板 `deliveries` 列最近 10 个完成房间。跨实例汇总未做。
- **调度台词项路由（2026-11-12）**：`suggestFor` 从请求提取中文二元词与英文词，对房间 name/goal/BRIEF/约束打分，再按 active 加权；理由显示命中词。它是本地启发式，不是模型语义路由，也不自动执行。
- **可交接记录与意图权威（2026-11-12）**：`store.appendEvent` 把治理事件镜像到 `.crew/rooms/<id>/events.jsonl`（append+fsync；SQLite `room_event` 仍是查询索引）；结论 commit 已带 transcript/events/evidence/BRIEF/GOAL/CONCLUSION。裁定 `BRIEF.md` 是 title/objective/done/constraints 的唯一权威；**设计裁定、代码未接**：`source_hash` 解析缓存与 `revise` 路由尚未实现，当前 P0 仍用房间 JSON + BRIEF。测试覆盖事件镜像，以及 `.crew` 被 `.gitignore` 忽略时结论 commit 仍带房间记录。
- **对标补齐第二阶段（2026-11-12）**：达标任务模型（status/owner/evidenceRef、revision、pastGoals、目标岛任务行）与用量时间序列（`/api/usage` 24h/7d/30d/12w/12m，小时/天/周/月分桶，侧栏用量页：花费/Token/缓存命中/回合/房间排名/柱状趋势）。UI 实测：7 天与 24 小时柱数正确，花费/Token/缓存命中/排名正确；高级显示 `修订：1` 与历史目标。边界：revision 冲突重试、任务依赖 DAG、历史目标下钻、按模型/席位拆分用量未做。
- **对标补齐第一阶段（2026-11-12）**：用量账本（`usage.jsonl` + `/api/usage` + 资源面板趋势）、约束分层（LODGE.md → AGENTS.md → CLAUDE.md，不越过 home）、MCP 熔断（3 次/10 分钟，按 server 暂停席位，`mcp.trip`/`mcp.reset`，高级面板恢复）、任务级地基（`stage.tasks` owner/status/evidenceRef，`revision` 与 `pastGoals`）。UI 实测：7 天费用柱状、任务「执行已交」、MCP 熔断恢复按钮生效、约束层来源显示。边界：完整任务状态机、revision 冲突处理、历史目标页与完整用量页仍在第二阶段。
- **资源面板与 MCP 审计（2026-11-12）**：`resources.js` 派生 `GET /api/resources`：全局花费/预算、房间状态、待你处理、失败命令、返工、冲突/部分成功、回合；调度台展示统计与房间表，点击打开房间，只读刷新，不路由不执行。参考 Claude-Bot 用量页的“分项 + 排名”思路，未做时间序列。`mcp.js` 解析 runtime 工具汇总里的 `mcp__server__tool` / `mcp:server:tool`，turn evidence 带 MCP 汇总，`mcp.call` / `mcp.failure` 写事件，失败写系统消息且只影响当前席位回合；基座侧参考 OpenMausBot 的每会话 loopback、AbortSignal 超时与关闭 failAll。UI 实测：2 个房间汇总花费、状态、失败命令、返工与待处理数，点击房间可打开。边界：Crew 侧逐服务超时/熔断与审计 UI 未做。
- **模板导入与部分成功（2026-11-12）**：`template.js` 用 `yaml` 解析本地 `.crew.yaml/.yml/.json`，预览席位名字/工位/提示词/引擎；`human` 席位跳过，权限与写范围按角色校验，模板不能提权；模板只用于本次建房，不落盘保存。UI 实测：导入内置交付三人组，预览 3 个 AI 席位，点“用这个模板”进入编制步骤。阶段可声明 `dependsOn`，`gateFor` 要求依赖阶段已过；并行执行失败席位写入 `stage.partial`，其余继续合并/验收，目标岛与复盘显示“部分成功”。边界：依赖图只有 API 声明，没有可视化编辑器；跨阶段 DAG 自动调度未做。
- **席位交接包与项目约束（2026-11-12）**：`seat-handoff.js` 在开场、阶段开始、验收复核时注入目标、done、约束、项目约束快照与最近 3 条复核意见，并引用 `.crew/rooms/<id>/transcript.jsonl`，单包上限 2,800 字；不重发整场对话，增量仍交给基座 delta-context。项目约束放在仓库根 `LODGE.md`，`GET /api/project/constraints?repoPath=` 读取；建房对话框可读取、改为本房间快照、取消勾选；创建时写入 `room.projectConstraints` 并把约束行写进 BRIEF，旧房间不随文件后改而变。真实 UI 验证：读取到 3 条约束、勾选带入、文本可编辑。边界：不写回 LODGE.md（要长期生效需人编辑文件）；不做 RAG/向量记忆；交接包只覆盖开场/阶段/复核，不注入每轮对话。
- **示范房间（2026-11-12）**：`examples/rooms/` 提供 4 个可导入交接包：3 个模拟样本（`cli-verbose`、`oauth`、`readme`，来自 `seeds.js`，标 `sample.kind=simulated`）与 1 个真实单席样本（`real-sum-fix`，真实跑完修复失败测试 → `node --test` exit 0 → 人签字完成，标 `real`）。`sanitize.js` 脱敏私钥、常见 API key、Bearer、邮箱、URL 凭据和本机路径；`samples:export` 从真实 data dir 导出，`samples:generate` 重建模拟样本。4 个包均实测可连续导入同一 Lodge，消息 ID 与房间 ID 不冲突；扫描无本机路径/密钥。边界：真实样本仍少（1 个），随 dogfood 增加；脱敏后仍应人工通读；不做模板市场。
- **复盘视图（2026-11-12）**：`review.js` 从房间状态 + 消息派生 `GET /api/rooms/:id/review`：成本/预算、回合、token（只读 turn evidence 的 usage；无上报则为 null）、证据命令通过与失败数、按阶段返工数与总返工、最近 12 条失败/返工/系统事件、工具调用统计。UI 房间头部「复盘」打开只读摘要。真实 UI 验证：成本 `$0.001 / $5.00`、Token `1,600（入 1,200 / 出 400）`、证据 `1/2 通过`、返工 1、阶段 1/2，失败列表按时间倒序，工具表正确。边界：不跨房间汇总、无时间趋势；成本与 token 是基座估算，不是账单。
- **目标岛打磨（2026-11-12）**：展开面板顶部常驻三问摘要（目标 / 进度 / 怎么算过），阶段节点显示返工与部分成功徽标；选中阶段列出打回（验收席位名 + 时间 + 意见）、证据链接、任务行（席位头像 + 状态 + 证据）、其余席位与目标检查。当前阶段变化时自动跟随；底部控制条固定在面板内；面板收成卡片并有进入动效，尊重 reduced-motion。数据从 `room` + `verdict`/`evidence` 消息派生，不新增真相源。UI 实测：三问、`↺2`/`×1` 徽标、打回署名、任务头像与证据链接、固定底栏均正确。边界：没有跨阶段返工趋势图；目标草案仍在建房流程，不在岛内。目标是独立模块 `ui/src/goal-island/`：`model.js` 生成标准 view，`index.js` 只接收 view/actions，`island.css` 自带样式；房间页不传 room/store，后续可直接替换实现。`model.test.js` 覆盖状态/轨道/三问/头像/证据返工过滤/席位状态；`ui.test.js` 用 esbuild + 假 React 渲染组件树，覆盖收起/展开/导入/停止确认，harness 改编自 Claude-Bot（Apache-2.0）`ds-bot/test/goal-client.test.js` 并保留归属。
- **Workspace 端口（2026-11-12）**：`workspace.js` 是端口与 provider 注册表，`workspace-git.js` 与 `workspace-plain.js` 是两种实现；`room-create`、`live-turns`、`service`、`workspace-gc`、`roster-recommend` 不再直接调用 git。建房写 `room.workspace = { provider, capabilities }`；旧房间没有该字段时按 git 解释。`paths.js` 增加 `roomRootOf`（`repoRootOf` 兼容别名），`repoPath` 字段不改。选择规则：用户指定非 git 目录时自动用 plain；`workspaceProvider: 'git'|'plain'` 可显式指定；空路径仍走 git 新仓库。plain 实现：复制隔离、文件清单证据、同路径不同内容判冲突、无候选 commit、无 commit 完成、一次性验收副本；复制合并不传播删除。源目录不被写入。`boundary.test.js` 门禁：除 `workspace-git.js` 与 `paths.js` 的默认根探测外，`server/crew` 不得直接调用 git。能力降级：evidence 写 `vcs`；完成留痕按 `commit` / `git-unavailable` / `archive` 分支；无 `merge` 能力时拒绝并行执行；无 `acceptanceCopy` 时验收命令不执行；UI 显示工作区能力与「无 VCS」，变更证据按 `vcs` 标成 diff 或文件清单。真实 E2E：非 git 目录建房 201，`provider:'plain'`，源目录未出现 `.git`，复制目录有源文件。并行 plain 建房走复制集成（测试覆盖）；复制合并不传播删除。
- **本地交接包（2026-11-12）**：`GET /api/rooms/:id/handoff` 从真实房间导出 `lodge.room-handoff.v1` JSON 包，含 BRIEF/GOAL/CONCLUSION/decisions/transcript/events/evidence，并把房间、源仓库、席位工作区、工作区根与 home 路径替换为占位符，不导出引擎绑定与本地路径字段。`POST /api/rooms/import` 校验格式、文件名（拒绝路径穿越）、大小与 transcript，再把文件写到 `<dataDir>/imported/<id>/.crew/rooms/<id>/`，用 `store.importRoom` 重建消息索引；导入房间 `imported/readOnly`，状态为 `complete` 或 `stopped`，所有房间动作返回 409，不占当前预算。真实 E2E：A 实例导出 → B 实例 201 导入 → 只读房间 2 条消息、BRIEF 可读、证据 200、pause 409、重复导入 409；UI 通过文件选择导入并显示「交接 · 只读」，高级里可导出下载。续做：只读记录页点「基于此记录续做」打开建房对话框，目标取自 BRIEF，必须填上一轮交付所在的本地仓库；`createRealRoom` 校验 `continueFrom` 必须是导入记录，继承 BRIEF done（没有现成 plan 时），写 `continuedFrom` 与系统消息，旧证据/阶段/会话不复制。真实 E2E：API 建房返回 `continuedFrom`、继承 done、单阶段验收命令；停止后删除了基座 group/bot。边界：交接包不含代码，续做依赖本地仓库；文件内容中的路径已替换，但业务文本本身不做脱敏；同一实例重复导入同一个包会因消息 ID 已存在被拒绝。
- **房间投影（2026-11-12）**：`/api/state` 与所有房间事件共用 `presentRoom`，统一附带 `needsYou`、`independenceLabel`、`independencePolicy`；UI 的状态条与高级面板直接消费这些字段，不再自己重算阶段/证据/verdict 状态和独立性文案。`presentation.test.js` 覆盖投影不修改存储房间。UI 仍保留 per-seat 展示状态（working/done）与阶段选择，这是展示层，不参与业务判定。
- **结果三态（2026-11-12）**：业务拒绝用 `fail` 映射 4xx；系统/基座/IO/工作区异常直接抛到组合根映射 500，不再用 `fail('conflict')` 包装。复核请求的业务条件用 `BusinessError` 区分，`service.verify` 只把这类错误转成 4xx；开工卡队长不可用、建房中途创建 bot/群失败会显式 500。
- **真实三人组（模板验证）**：从界面建房 → Engine 端口在基座创建三个 bot（同引擎，明确标「独立性降级」）+ 一个群 + 一个房间仓库；队长提示词要求 ≤3 问对齐（未强制）；人确认后系统 @执行；执行回合后自动跑验收命令；验收席位独立复跑并给 PASS/REJECT；人签字 → `CONCLUSION.md` + 一次本地 commit。
- **开工卡（2026-11-11）**：建房前由队长读目标与仓库事实，给出一张开工卡：done、席位/职责/理由、验收方式、最多 3 个带推荐答案的问题；业务用 `validateRoster` 校验，UI 展示 done/问题/编制/验收，人确认一次直接开工，不再二次对齐；答案与 done 写进 BRIEF，手动模板只作覆盖。真实小目标验证：队长建议 1 个执行席位而不是三人组，约 7–8 秒返回；按卡建房没有对齐阶段，worker 直接开工，BRIEF 含 done 与编制理由，跑通到人签字与 commit；临时队长线程/工作区已清理。manual 开工卡也验证：产物就绪后生成 manual 证据，`needsYou=等你验收`，人签字后结论 commit。边界：建后改席位未接；角色仍限队长/执行/验收；验收席位可多个，全部 PASS 才签字（任一 REJECT 打回）；基座不可用或建议不可解析时显式回退“手动选编制”，不静默套模板；建议只读，用户目录不是 git 仓库时显式失败，不在用户目录里 git init。
- **模板驱动与按需编制**：席位是数据，三人组和单人只是模板；建房可传 `seats: [{ role, name }]` 自定义编制，服务端只接受 `lead / worker / verifier`，权限由角色派生（自定义不能自己发明能力）。约束：至少一个 worker，最多一个 lead；执行与验收都可多个，多执行并行、多验收各自独立复核且全部 PASS 才允许签字。无 `lead` 时跳过对齐，直接进入交付；无 `verifier` 时门禁按席位表判断，真实证据 + 人签字即可通过；有 verifier 或席位表未知时仍必须拿到 PASS。已用真实 CLI 跑通单人全链路：执行 → 验收命令 exit 0 → 人签字 → `CONCLUSION.md` → 本地 commit，工作树干净。
- **首屏**：默认不 seed 演示房和调度假请求；空状态只有一个「开一个房间」；对齐/派活/复核提示只进基座线程，不进 Lodge 时间线。
- **注意力路由**：`attention.js` 从房间状态派生 `needsYou`（待确认/待回答/待签字/待复核/退回/待设命令）；侧栏显示一个点与「N 个等你」，调度摘要同步；不为每条消息做未读。
- **能力扩展缝**：席位声明 `skills / mcp / approval`，启动时校验；crew 只传 `approval / mcp` 语义，`approvalMode / mcpServers` 的映射只在 `engine.js`（实测 soul 与 approvalMode 生效）；MCP 默认关闭，planner/verifier 不放外部工具；技能只存引用，`capabilities.skills=false` 时建房 fail closed。`boundary.test.js` 会拦住 crew 里的基座词汇，`store.test.js` 覆盖旧 schema 的增量迁移。
- **触发扩展缝**：定时/事件任务归基座 routines/webhooks，crew 只存 `triggers` 引用与授权，不写 cron 循环；当前未接，`capabilities.schedules=false`，默认关闭；主动档位等真实后台检查与审批跑通后再开。
- **调度台**：仍是只读前台——收件、建议、一次确认、投影摘要；不做能操作界面的全局助手。若要加，只能是 read + propose（解释、打开面板、生成草稿），最终动作由用户点。
- **真实 M3 验证（2026-11-11）**：用临时源仓库 + 全新数据目录跑通三人组：3 个基座线程、3 个工作区、executor 分支正确；planner 克隆没有 `hello.txt`；executor 在自己的 worktree 创建文件，源仓库 `main` 仍干净；候选 commit 在 `crew/<room>/executor`；verifier 临时副本拿到候选文件并给 PASS；人签字后 executor 工作树干净，结论 commit 含 `CONCLUSION.md`；交付在房间分支上，可人工合并。另验证两席自定义房（执行+验收）与无验收房（队长+执行，`human` 人签字）；测试 bot 与群已清理，基座回到只有 MausBot。
- **并行执行（2026-11-11）**：自定义编制可含多个执行席位；每个执行独立 worktree/分支，同一交付阶段并行派发。全部执行回合结束后，按顺序把候选分支合并进房间集成 worktree（`crew/<room>/integration`），在集成目录跑验收命令，再交验收席位复核。合并冲突会回滚并停下等人（`needsYou.kind=merge`）；15 分钟未完成报超时（`kind=parallel`）。真实双执行验证：前端/后端各自 worktree + 候选 commit，集成合并、验收 exit 0、verifier PASS、人签字、`CONCLUSION.md` + 结论 commit；源仓库 `main` 干净，交付在 integration 分支，候选分支保留供人工查看。单元测试覆盖集成 worktree、合并、冲突回滚。
- **下一步（设计文档 §15.1）**：worktree 生命周期与成本硬闸门已落；Windows 适配器已落但需真机 dogfood；P0 剩余建后移除/改角色与真机验证；M2 后先做 5–10 人私密 dogfood（只收卡住点，不公开演示），再按真实卡点排 P1；P1 是业务感知交接包、本地房间交接包、工作区级项目约束、子任务依赖图/阶段级部分成功、MCP 隔离与审计、复盘/用量视图、调度台只读资源面板、本地模板导入。明确不做：模板市场、多人协作/Org、非编码模式、自动执行、第二个有写权限的全局助手、黑盒 RAG。
- **已知边界**：UI `app.js` 是单文件页面，后续可按视图拆分（目标岛已独立成模块）；本地模板导入已接，但没有模板持久化库/市场；Engine 端口是房间级语义；M1 游标/轮次/空转已落，业务感知交接包已落（实际增量仍由基座 delta-context 负责）；房间记录随结论 commit 可带走，导出/只读导入/续做已接；M2 真 Stop 已接（未做 500ms E2E），@ 基础有；M3 席位隔离与并行 executor worktree 已落（planner 克隆 / 多 executor worktree / 集成 worktree / verifier 临时副本 + 候选提交）；worktree 生命周期已落（环境/端口/清理/GC/磁盘水位）；验收命令一次性副本与网络 isolator 已落（macOS/Linux；Windows 走 WSL2 + bubblewrap，缺原语 fail closed）；成本硬闸门已落（房间/全局预算到线暂停新任务），发言配额未强制；venv/本地数据库/端口强制隔离未做；工具审批桥已落（写工具拒绝；外部动作挂起等人批准；exec 仍是临时副本，不是通用文件系统沙箱）；建后加席位已接，移除/改角色未接；多验收席位已接（全部 PASS 才签字，任一 REJECT 打回）；manual 验收不挂 verifier（要独立复核必须补命令，fail closed）；并行合并冲突需要人处理，没有自动重排；验收已走盲审提示，无显式引擎时优先不同厂商、没有第二引擎时降级；独立模型守门在 M4；编制建议依赖基座可用，失败时显式回退手动选编制；Goal 有队长时三段式/最多 3 个工作阶段，开工卡 >3 问拒绝；阶段可视化编辑/分叉会议未做；独立模型守门 agent/M4 独立复核会话/无第二引擎时的稳定跨厂商/跨实例交付汇总/模型语义路由/发言配额未做；Electron 未接，TypeScript 只在基座；SQLite 仍是原型索引，关系表迁移只改 `store.js`。

## 9. 许可与合规

- OpenMausBot：Apache-2.0；保留根 `LICENSE`、`NOTICE` 与源文件头。`enterprise/` 是单独的商业许可，删除。
- Claude-Bot / DS Bot：Apache-2.0；优秀设计与代码可复用，保留 LICENSE、NOTICE 与文件头；不复制 enterprise/商业代码，不引入 DSH 宿主/插件/store 耦合。
- 商标：OpenMausBot / MausBot 名称与吉祥物是商标，Apache-2.0 不授予商标权；产品名用 Lodge，换掉一切上游品牌资产。
- 我们自己的仓库补 `LICENSE` 与 `NOTICE`（如包含上游代码）。

## 10. 风险

1. **基座太大**：删除产品面的工作量可能超过预期。Spike 先证明 UI 与宿主可替换，再全量迁移。
2. **上游演进**：driver 接口可能变。产品代码集中在 `server/crew/` 与 `ui/`，减少冲突面。
3. **状态双写**：房间消息日志以 `transcript.jsonl` 为权威（先追加并 fsync）；SQLite/`room_event` 是运行时状态、索引与 trace。索引可重建，不用 SQLite 反向覆盖 transcript。
4. **权限语义**：席位权限表要映射到 ACP 的 `session/request_permission` 与 approval mode，不要把「只读」当成安全边界。
5. **Node 版本**：基座要求 Node ≥24（strip-types）；Mac arm64 用 24 LTS，CLI 路径按 `/opt/homebrew/bin` 探测。
