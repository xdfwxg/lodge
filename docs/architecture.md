# Lodge · 架构

> 本文回答：服务端怎么分层、数据真相在哪、交接和门禁怎么走、边界靠什么固定。
> 通用判断与**原则总表**见 [思想.md](../思想.md#原则总表)，界面规则见 [design.md](design.md)，运行与运维见 [operations.md](operations.md)。

## 形态

- 服务端 Node 24，ESM，无框架；UI React 19，`createElement`，Vite；桌面 Electron 壳，macOS 发 ad-hoc 签名 zip。
- 工作室按职责分四个子目录：`rooms/studio/acceptance/`（验收与判定：acceptance、gates、review + 六条 checks）、`plan/`（规划与阶段：apply-plan、stage、progress）、`delivery/`（交付与交接：proof-runner、integration、handoff、write-boundary）、`runtime/`（运行时编排：turn-capture、planner-turn、worker-result、result）。验收规则一条一个文件，加规则只加文件。
- 「停没停」只有一份事实：`crew/stop.js` 的 `stopOf(room, messages)`。顺序固定为房间级的人的事（审批卡、问答卡、连接）→ 阶段级显式停住（`blocked`，越界读不算）→ 房间级暂停 → 房型自己的待办；房型只把 `stopOf` 挂在自己身上回答“这一步缺什么”，不再各写一份判断。“为什么停住”是一份词表加一份措辞表：`shared/states.js` 的 `BLOCKED_REASON` 只列真正会被写的五个理由（越界读不算），`crew/blocked.js` 给每个理由一句话，并声明它算不算“等人”；没登记的理由如实说“这一步停住了”，不冒充“执行超时”；`blocked.test.js` 扫所有写 `blocked` 的地方，写了词表外的理由就红。界面、侧栏、灵动岛、评测都读这一个返回值；`needsYou` 字段就是它的投影。「平台手上还有没有活」同样只有一份定义：`crew/in-flight.js` 的 `platformBusy` / `recentlyActive`（回合在跑、派工在路上、成员在忙、最近有工具活动），只压“基于旧证据”的卡，不压人的交接、阻塞和超时。
- 复核自己再分四块，`review.js` 只做入口：`review/session.js` 管一轮复核的状态（谁在看、超时、什么时候算停，房间的复核状态只有这里可写），`review/request.js` 发起（副本、渲染图、提示词、计时），`review/verdict.js` 判一票算不算数（两条通道 + `review/checks/`），`review/settle.js` 决定一轮结束后去哪（人数凑齐→交付/收尾，退回→返工/交给人）。
- 基座是本仓库的 Rust 薄基座（`base-rs/`），HTTP 接入，默认 8799；只有一个实现，没有可切回的旧基座。
- 数据在 SQLite 单文件 + 房间目录的 transcript 与证据里。

## 设计理念

下面是 Lodge 的实现判断；通用原则见 [思想.md](../思想.md)。

- **房间长期存在，轮次才是工作单位。** 完成只结束这一轮；房间回到空闲，工作区和成员留下。
- **规则和管道分开。** `kernel/` 只写状态和转换；`store/` 只写事务和仓库；`actions/` 只写 HTTP 动作；`rooms/*` 只写房型执行。规则不依赖 SQL、端口或具体引擎。
- **传输面是一份显式协议。** `server/api-contract.js` 列出每个接口的方法、路径、回应形状（json / events / bytes / static）和鉴权口径（none / token / room）；**路由表就是它本身**：`http.js` 只提供每个接口的处理函数（`METHOD path` 为键），分派器按契约顺序匹配；模块加载时对账（少处理函数或写下表里没有的接口，启动即失败），`server/api-contract.test.js` 再锁一次形状与参数匹配。房间动作仍由 `route-table.js` 的 `ROOM_ACTIONS` 说了算。这是照 Codex App Server 的做法：协议是产品面的一份显式产物，不是散在 if 里的路径。
- **五层各有各的活，规则能拒绝。** 内核（`kernel/`：状态与转换）→ 业务（`rooms/`、`service`：房间、阶段、验收）→ 驱动（`base-rs/drivers` + `server/base.js` 端口）→ 传输（`http.js`、`app.js`：解析、鉴权、投影、装配）→ 界面（`ui/`、`electron/`）。Claude Code 与 Codex 的形状与此一致：内核不认传输，传输只做翻译，界面是纯客户端；差异只在传输形态——它们的本地面是 stdio（Codex App Server 的 JSONL、Claude Code 的 MCP/SDK），我们的界面是 web 渲染层，所以传输必须是回环 HTTP（Codex 的 Web 版同样是 HTTP+SSE）。**没有照抄的两处**：发现文件（`~/.claude/ide/*.lock` + `kill(pid,0)`）——我们的客户端都由桌面壳或评测直接拿到端口，加了没人用；stdio 传输——浏览器拿不到管道。
- **五层现在的依赖门禁（全部验证过会拒绝）**：`no-circular`、`ui-not-to-server`、`server-not-to-ui`、`ui-not-to-electron`、`ui-not-to-node`、`shared-not-to-node`、`shared-not-to-app`、`shell-not-to-server-modules`、`crew-not-to-transport`、`kernel-only-through-kinds`、`kernel-not-to-room-engines`、`rooms-not-to-base-adapters`、`chat-not-to-studio`、`studio-not-to-chat`、`crew-core-not-to-adapters`。
- **每层不知道上层。** `shared/` 是纯契约（不 import `node:`，判据怎么用由调用方注入，例如 `openablePath` 的 `stat`/`realpath`）；`ui/` 只 import `shared/`；桌面壳 `electron/` 只拉起子进程和窗口，不 import `server/` 或 `ui/`；`server/crew` 不 import `http.js`/`app.js`。三条都由 dependency-cruiser 拒绝，不靠自觉（`shared-not-to-node`、`shell-not-to-server-modules`、`ui-not-to-server`、`server-not-to-ui`）。**判定也不跨层**：服务是不是活着，由壳从外面 TCP 探活（`electron/launch.mjs` 的 `probePort`）后杀进程重启，服务自己的自检只给没有监督者的 CLI/dev 兜底。
- **一个持久队列。** 定时、审批、重试和启动回收都进 `work_item`；先落库再执行，租约、退避、去重和死信同表。
- **一层一个状态。** 房间说 `idle/active/paused/stopped/archived`；轮次说 `planning/active/completed/rejected/failed/superseded/stopped`；界面不再用一个 `complete` 同时表示两者。
- **事务边界就是业务边界。** 轮次开始、完成、停止、退回、失败、作废都在一个事务里改轮次、房间指针和事件；不允许“阶段全过但房间卡住”。
- **已验证的能力不重写。** gates、验收、workspace、engine 是执行能力，不是这次要换的管道；内核只负责把它们组织成可恢复的长期工作。
- **为长期任务赢，不靠模型或提示词。** 差异化在连续性、证据、恢复和人的介入点；模型只做理解与计划，完成、权限、证据和金额的判定留在代码。

## 控制放在哪一层

通用判断见 [思想.md 的「控制放在哪一层」](../思想.md#控制放在哪一层)；这里只留 Lodge 的路线取舍。

**几条路线怎么摆。** 它们不是同一层的替代品：

| 路线 | 回答什么 | 什么时候赢 | 陷阱 | Lodge 的取舍 |
| --- | --- | --- | --- | --- |
| 薄循环、模型主导 | 谁决定下一步 | 模型强、错误可逆、任务开放 | 误读成“没有 harness” | 语义层采用；状态与权限仍在平台 |
| 自进化 harness | 谁写约束 | 有稳定评测、重复任务多 | 没有外部 oracle 就是奖励黑客 | 以后只做技能结晶，先评测再让人批 |
| 原生能力优先 | 能不能少靠拐杖 | 下一代底座；安全/审计之外 | 拿未来能力做当前保证 | 北极星；只删语义脚手架，不拆物理 |
| 模块化 / 可插拔 | 怎么组合 | 多模型、多部署、确有第二实现 | 抽象税 | 只在模型、workspace、验收有第二实现时端口化 |
| 操作系统式平台 | 状态和长时运行放哪 | 多任务、长任务、要恢复和审计 | 做成通用内核，忘了产品 | 房间/轮次/证据/队列就是这层 |
| 独立验收 | 谁判对错 | 质量可被证据裁决 | 两个模型互评不是验收 | 确定性检查 → 证据 → 人 |

- **顺序：平台 > 独立验收 > 薄循环 > 选择性模块化 > 原生能力（方向）> 自进化（最后）。**
- “薄循环”是**任务流程薄**，不是 harness 薄。Claude Code 的循环由模型推进，但权限、上下文压缩、hooks、技能、审计一样不少；它砍掉的是外部写死的 DAG。
- 自进化只做“成功回合 → 候选技能”：先提案、先评测、再让人批准；不改权限、重试和流程。没有稳定 oracle 的自我进化，是在优化一个它自己定义的分数。
- 原生能力的路线图是“让语义脚手架可删”，不是“拆掉安全与审计”；审计、权限、证据不会因为模型变强而消失。
- 新机制先过五问：写的是**流程**还是**物理**？失败可逆吗？能被**证据**裁决吗？有没有第二个真实实现？它让系统更会**验收**，还是只是更会**表演自主**？

## 分层

```text
Electron / Web
      │ HTTP + SSE
ui/src/store.js              ← 唯一的 UI 传输适配层
      │
views + room/<kind>/view.js  ← 房型视图策略
──────── HTTP / SSE 边界 ────────
server/index.js              ← 进程入口（监听、信号、退出）
server/app.js                ← 唯一组合根
service.js                   ← 路由分发与用例组合
应用层：rooms/*、kernel/live/*
领域层：room-types、gate、assignments、verifiers、orchestration、presentation
端口：crew-ports、runtime-port、workspace-ports、surface-port、threads
适配器：store、engine、workspace、surfaces/base
```

依赖只向内：领域层不依赖应用层、端口或适配器；应用层只用注入的端口；适配器只在组合根装配；UI 不 import `server/crew`。

## 房型是策略

房间是唯一实体，运行模式是挂在房间上的策略，不是另一套房间模型。

| 单元 | 职责 | 变化原因 |
| --- | --- | --- |
| `Room` 记录 | 目标、成员、状态、阶段、Assignment、证据、交付；唯一实体 | 房间协议 |
| `room-types/*` | 名称、默认成员、能力矩阵、创建纯规则；不持有运行时 | 产品描述符 |
| `rooms/<mode>/kind.js` | 只装配模式策略；成员、需要你、记录、投影各自成模块 | 模式组合 |
| 模式内模块 | 聊天：`service` 认领消息、`scheduler` 编排、`prompts` 写提示、`brief` 取上一轮结论、`issues` 做投影；工作室：`needs` 判等待、`record` 写约束和开场、`issues` 做阶段/复盘投影、`review` 协调复核、`review-prompts` / `review-policy` 只管复核文案与判定规则、`runtime/diagnostics` 只写回合诊断；各自可独立测试 | 单一职责 |
| `rooms/kinds.js` | 唯一注册表；把策略裁成 `mode` / `presentation` / `lifecycle` 三组窄接口 | 组合与替换 |
| `service.js` | 路由与业务编排；模式差异优先走注册表钩子，具体模式用例在组合点装配 | 用例流程 |
| `ui/src/room/*` | 房间壳、房型视图、岛、共享展示；不 import `server/crew` | 呈现 |

**接口与依赖**

- 模式差异依赖 `roomModeForType`、`roomModeOfRoom`、`roomPresentationOfRoom`、`roomLifecycleOfRoom`；三组接口分别回答“怎么建/怎么跑”“只读投影什么”“哪些动作会改状态”。轮次启动、成员能力这类差异走策略钩子；`service.js` 作为组合点装配具体模式用例。
- 模式差异的依赖方向是 `service → 注册表 → kind`、`kind → shared/ports`；反向 import、UI import 服务端、聊天室和工作室互 import 都由测试拦住。基座群聊线程只经 `ports/threads` 暴露，房型不直接 import `rooms/live` 的适配器。
- 新增模式 = 描述符 + kind + 视图 + 自己的动作入口；不改 `Room`、另一间房或共享房间协议。运行期不切换房型；底层角色仍是规划师/执行官/验收员三类。

**为什么这么分**

- **策略模式**：房型是运行策略，不是第二套房间模型；调度/圆桌/专项/接力共用同一份房间、成员和 Assignment 协议。
- **接口隔离**：创建运行、只读投影和生命周期分开，调用方只拿需要的那组，避免房型接口膨胀。
- **开闭与替换**：注册表和契约测试保证新模式可替换；关键生命周期已走钩子，剩余模式路由集中在用例入口，不再扩散到房间本体。
- **不可拆分标尺**：一个模式的创建记录、等待信号和只读投影能独立测试、独立变化，所以各自成模块；`kind.js` 只负责把它们装配成同一份策略。房间身份、消息和交接必须一起保持一致，所以留在房间本体。

## 基座切片（薄基座）

Lodge 只依赖基座的一小片；这一片足以跑起聊天室和工作室。换实现（包括 Rust）时按这份契约验收，基座的其他能力不属于 Lodge。

**端点（10 组）**

- `/api/bots`：成员身体——创建、改、删、技能、叫停、模型选择。
- `/api/groups`：房间群、成员、@ 开关、持有、已读。
- `/api/threads/`：线程历史与订阅前的事件。
- `/api/events`：SSE 流（`delta` / `message` / `room`）。
- `/api/instances`、`/api/config`：运行时、模型目录。
- `/api/mcp/servers`：MCP 增删改查；按回合的 gate 配置由 Lodge 用工具范围生成。
- `/api/attachments`、`/api/files`：附件与文件。
- `/api/skills-library`：技能库（列表 / 读取 / 导入 / 启用 / **删除**；同名导入不覆盖，要换正文就删掉旧的再导入新的）。

**端口方法**：见 `server/crew/runtime-port.js`——turns / rooms / members / cards / observability，加 `mcp` 命名空间。业务只调用这些方法；实现缺少任何一个，启动即失败。

**事件与不变量**

- `delta` 只带增量；`message` 已归一化为 kind/text/meta；`room` 是规范化 Room。
- 一次回合：started → 若干 delta/message → completed；中断、取消、超时都必须有终态。
- 权限卡走 `request.opened` → `answerCard`；卡片带 `requestId`、`requestType`、**真实工具名**（不是确认问句）、`summary`。
- 线程、会话和 resumeCursor 由基座持有；Lodge 只存引用。
- 用量与 digest 由基座记账；Lodge 只读。

**数据归属**

- 基座：bot、群、线程、消息流、会话、用量、附件。
- Lodge：房间、阶段、证据、判定、交接、工作区、预算。
- 房间真相不写进基座；基座里的群只是投递通道。

**agent runtime 不在基座里**

pi、claude 这类引擎是可替换的子进程：`scripts/prepare-runtimes.mjs` 按平台下载预编译二进制到 `build/runtimes/` 并固定版本，驱动 `server/drivers/*.ts` 只负责 spawn、streaming JSON-RPC 和事件翻译。基座（包括 Rust 薄基座）不内嵌任何引擎实现，只做进程监督、协议、审批转发和 MCP 代理。

薄基座启动时扫描本机命令（PATH 与常见安装目录），发现 pi、Claude Code、Codex、Gemini、OpenCode、Cursor Agent、Aider，通过 `/api/instances` 报告命令、版本、状态和能探测到的登录状态；只有实现了 runtime 契约的驱动才标 `available`，其余标 `unsupported`，不冒充可用。当前驱动是 **fake / pi / claude / codex**：claude 有二进制时标 `available`（`driverKind: "claude"`，模型列表留空让 CLI 用自己的配置）；codex 有二进制时标 `available`（`driverKind: "codex"`，模型列表固定 `deepseek-chat`）；其余 agent 仍标 `unsupported`。

pi 以 `--no-session` 运行，基座的线程仍是唯一历史；驱动每轮把线程最近的消息和成员的 soul 一起交给它，所以模型换代或会话结束都不影响房间记忆。**技能按需读**：提示词里只列“名字 + 一句话”的清单，正文写进回合目录，由扩展注册的 `use_skill` 工具现取（读到的只能是这个成员分到的技能），真实探针 `npm run base:rs:skill:real`。claude 拿同一份清单，正文由一个只有 `use_skill` 的 stdio MCP 服务器现取：`--mcp-config` + `--strict-mcp-config`，只放行 `mcp__lodge_skills__use_skill` 这一个工具；不走原生 skill 机制，那会把用户级和项目级技能也带进来，成员看到的会比房间给的多。真实探针 `npm run base:rs:claude:skill`。claude 仍是每回合新进程，`--tools ""` 关掉全部内置工具，只做聊天成员。codex 用自己的技能目录：每回合一个隔离的 `CODEX_HOME`（回合临时目录），技能按 `<name>/SKILL.md` 写进 `$CODEX_HOME/skills`，清单和正文都由 codex 自己发现与读取，提示词里什么都不加；真实探针 `npm run base:rs:codex:skill`。codex 的 `--sandbox` 在基座沙箱存在时用 `danger-full-access`——外面已经有 seatbelt / Job Object，它再套一层自己的沙箱会在里面起不来（`sandbox_apply: Operation not permitted`），工具全哑；没有基座边界时才退回它自己的只读沙箱。

**为什么先削这一层**

基座厚重是因为它替很多产品干活——会议、电话、连接器、apps、邮件、云同步、团队、例程、记忆日志、agents bridge、浏览器/电脑/VPS；Lodge 一个都不用。先锁契约，再决定实现语言；三道门是：端口契约测试、端点白名单（`server/base-slice.test.js`）、`eval:rooms`。

**Rust 放哪**

- **适合 Rust**：进程监督、CLI 的流式 JSON-RPC 解析、并发与背压、MCP stdio/HTTP 代理、SQLite、SSE、平台沙箱（macOS seatbelt，Windows 见下）、单二进制分发。
- **留在 TS**：房间、阶段、证据、验收、gate、提示词、界面——这些是产品真相，不跟着基座换语言。
- **迁移顺序**：契约测试 → 薄基座并行跑（同一份端口）→ 按端点切换 → 老基座只作 fallback → `eval:rooms` 通过后删掉旧路径。
- **骨架**：`base-rs/` 已落 SQLite 持久化与重启恢复、事件身份与 SSE 重放、回合终态、权限卡、自动发现，以及 fake / pi / claude / codex 四个驱动；`npm run base:rs:test` 覆盖契约、持久化、pi、claude 与 codex 驱动、沙箱和孤儿清理，`base:rs:conformance` 用同一份形状检查跑新旧基座，`base:rs:pi:real`、`base:rs:claude:real` 与 `base:rs:codex:real` 各跑一次真实模型回合。
- **成员工具面与技能**：bot 设置的 `nativeTools` 是成员的工具授权；Lodge 按成员权限派生（读→read/grep/find/ls，写→write/edit，执行→bash），只有 pi 实例上传这个字段。基座不藏工具：pi 的全部工具都交给运行时，扩展按授权在调用时拦，没授权或被房间禁止的手看得见、用不了，并说明原因——藏起来会让 agent 不知道自己能申请什么，也会随 pi 升级漏掉新工具；授权名单不做硬编码白名单，pi 升级多出的工具声明就能用。技能库（`/api/skills-library`）存 SKILL.md 正文、同名不覆盖，分配挂在 bot 上；system prompt 里只放技能清单（名字 + 一句话），正文按需读。
- **MCP**：`/api/mcp/servers` 存服务器定义；回合开始把成员声明的服务器写成临时配置，由基座注入的小扩展注册（`base-rs/src/drivers/pi-base-extension.mjs`），`toolScope.deny` 翻成 pi 的 `--exclude-tools`。Lodge 的 `lodge_gate` 与浏览器服务器都能挂上；外部工具的审批卡已随扩展接通：成员 `approval: ask` 时，非只读、非房间契约、非 auto 的 MCP 工具先开审批卡，拒绝就不执行；真实 pi + 真实 MCP 服务器有端到端探针 `npm run base:rs:mcp:real`（允许才会执行、拒绝不执行）。用户级 `mcp.json` 隔离仍未做。
- **MCP 网关**（`base-rs/src/mcp_gate.rs`，`--mcp-gate`）：每个外部 stdio 服务器前挂一层基座进程，只做三件事——结果按预算裁（默认 8000 字符，多块文本共用一份预算）、全文落在回合临时目录、工具面封顶（默认 64 个，描述裁到 600 字）。截断的提示里给出路径，另注册一个 `lodge_mcp_read`（按 `offset`/`limit` 分段读回，只认本回合落盘目录，不问审批卡）——不依赖成员有没有原生读文件工具。网关不改协议、不碰审批、不代理远程 url 服务器（没有本地进程可拦），上游命令和它自己的配置通过 `LODGE_MCP_UPSTREAM` 分开。`npm run base:rs:test` 里有不连模型的探针 `base-rs/mcp-gate.test.mjs`。
- **附件与文件**：`/api/attachments`（图片上传、按名读回）与 `/api/files`（原文件名上传）。名字由基座生成（uuid + 扩展名），元数据入库、字节落盘到数据库同目录的 `attachments/`；带路径的名字一律 404，单件上限 12 MB。
- **工具活动**：pi 的 `tool_execution_start/end` 落成 activity 消息，结束那条带回执；房间靠它取 `submissionId`，界面靠它显示这一回合做了什么。活动消息带 `step.target/detail`（命令或路径的短摘要，不替人判断该不该做）；开始那条不写 `ok`，房间据此知道它还在跑。同一次调用在时间线上只有一行：Lodge 的投影按 `itemId + turnId` 复用第一次的 id，后到的回执覆盖前一条，不把一次 bash 记成两条。digest 的 `toolCalls` 是本回合真实发生次数（驱动计数），诊断和界面不再自己猜。
- **工具审批**：每回合都给 pi 挂一个基座扩展（`base-rs/src/drivers/pi-base-extension.mjs`）。只读工具（read/grep/find/ls）直接放行；`bash` 只问外部和不可逆的动作（联网、装包、发布、提权、改远端、`http(s)://`），写工具只问工作副本之外的路径，本机读写和执行由沙箱兜底——否则验收员跑一条 `ls` 就要等人，没人看着的房间一定停住（真房第七到十轮就是这样卡住的）。写工具和外部 MCP 工具在 `approvalMode=ask` 时走 `extension_ui_request → 审批卡`，人拒了就 block 并说明原因；`lodge_gate` 的契约工具不算外部动作。`approvalMode=auto` 直接放行。扩展还按 `LODGE_GRANTED_TOOLS` 强制工具授权：没授权的手在 `auto` 下也拦，并写明原因。
- **能力与副作用**：基座不限制 agent 能做什么，只保证做过的事看得见、停得下。工具不藏：pi 的全部工具都交给运行时，成员能用哪些由房间授权在调用时拦（没授权、被禁止的手看得见、用不了，并写明原因）；`nativeTools` 声明不再经过基座硬编码白名单，pi 升级多出的工具声明就能用。预算是资源保险丝而不是能力上限（工具调用数与墙上时间给足，房间可以续；另外有一个**空转窗口** `idleMs`（默认 2 分钟）：整回合可以长，但模型服务一直不出字就停，终态写「模型服务 N 分钟没有动静」，不把回合挂到四小时；卡住的回合白等十分钟比停早了再重试贵得多）；等人回答审批卡可以等满这一回合，不会到 15 分钟就把卡丢掉。留在基座里的限制只有副作用边界：外部动作审批、沙箱的文件与网络、资源上限。
- **出口门（默认开）**：基座进程起一个本地 HTTP/CONNECT 代理，pi 和它拉起的工具只认 `HTTP(S)_PROXY`，沙箱网络规则同时只允许连这个代理端口；代理远程按主机白名单放行（各家 `*_BASE_URL` 的主机、常见厂商主机、`LODGE_EGRESS_ALLOW` 追加），**本机回环只按端口**放行（`*_BASE_URL` 指向本地模型时收其端口，`LODGE_LOCAL_PORTS` 追加），远程名字解析到回环/内网/链路本地（含云元数据地址）也一律拒绝，其余 403 并计数。回环不能按主机放行：基座和 Lodge 的控制 API 就在回环上，放开主机等于给成员一条绕过边界调平台的路（已修，fake-pi 契约锁住）。`/api/health` 报 `egress: proxy|off` 与 `egress_blocked`；代理起不来就拒绝启动（fail closed）；`LODGE_EGRESS=off` 是显式退路。pi 启动期网络动作用 `PI_OFFLINE=1` 关掉，避免绕过代理。
- **沙箱（macOS 默认开，`LODGE_SANDBOX=off` 可退）**：`base-rs/src/sandbox/` 分三层——`plan.rs` 是唯一的构造函数，把显式输入（工作副本、别人的工作副本（同房与跨房）、基座数据目录、HOME、出口代理）算成一份边界值 `TurnSandbox`；`seatbelt.rs` 只把值渲染成 SBPL、把命令包进 `sandbox-exec`，不判断什么该允许；`mod.rs` 提供 `apply`（代理环境、每回合引擎目录、平台包装）与 `state`。**要沙箱却立不起来就拒绝这一回合**（fail closed），不静默降级；`/api/health` 的 `box` 字段报告 on/off。边界：读默认开放，但**别人的工作副本（同房与其他房间）、基座数据目录、以及 `plan.rs` 里唯一一份凭据表**（`.ssh`、`.aws`、`.gnupg`、`.config/gh`、`.config/gcloud`、`.config/op`、`.npmrc`、`.netrc`、`.pypirc`、`.git-credentials`、`.cargo/credentials*`、`.docker/config.json`、`.kube/config`、Chrome/Firefox/Safari/Edge/Brave 的配置）**连读都拒绝**；写只允许成员自己的副本、回合临时目录、系统临时目录与用户临时根（钥匙串模块缓存在这里）、`/dev/null`、`/dev/stdout`、`/dev/stderr`、`/dev/fd/{1,2}`，工作副本里的 `.git` 只读。规则结论借用旧基座 `server/bot-box/seatbelt.ts`（Apache-2.0，见其 `LICENSE`/`NOTICE`）。沙箱里 pi 用每回合的引擎目录（`PI_CODING_AGENT_DIR` 指向临时目录里的拷贝），不碰真实 `~/.pi`；登录仍走系统钥匙串。**环境只带声明过的几样**（PATH/HOME/TMPDIR/编码/终端/TLS），平台凭据与平台变量一概不进孩子；**信号只作用于沙箱内的进程**（`target same-sandbox`），成员管得了自己的工具，碰不到基座和 Lodge；**剪贴板 mach 服务（`com.apple.pasteboard*`）被拒**，成员读不到也写不进用户剪贴板；setuid 程序（`ps`、`sudo` 等）在沙箱里执行不了，提权路径一并堵住，代价是依赖它们的工具不可用；**回合临时目录有公共根**，别的回合的目录（含引擎凭据拷贝）读不到、写不进，自己的目录最后重新放开；**出口解析到回环/内网/链路本地地址的主机名一律不连**，并按解析出的地址直连，避免 DNS 重绑定。单测覆盖规则渲染与去重（含“会挡住自己的 deny 规则不收”），fake-pi 契约测断言 HOME 写被拒、兄弟副本读不到，真实 pi 回合在默认沙箱下跑通。**证明/反例走基座受限执行**：`POST /api/sandbox/run` 只接受声明根（`LODGE_WORK_ROOTS` 加系统临时目录）下的 work，整轮不出网（`Network::None`），超时杀进程组，环境和回合共用同一份 scrub；Lodge 的 `proof-runner` 不再 spawn 命令，入口清单里只剩平台自己的工具。**平台执行者要有边界**：git、lsof、sips、截图渲染逐个登记，并声明它的写/读/网边界与对应测试。截图器：网络用死代理 + host 规则关死；页面以 `data:` 来源交给 Chrome（不透明来源读不到 `file://`，也跳不过去），两条各有一条像素级测试。代价：相对资源不加载，预览需自包含；超过 2 MB 的 HTML 跳过预览。**资源上限与声明**：单文件上限由成员声明（`settings.limits.fileBytes`，默认 512 MiB，1 MiB–8 GiB），包装层用 `RLIMIT_FSIZE` 落到整棵进程树；进程数由看门人每 2 秒数一次**整棵进程树**（按 ppid 递归，不只看进程组——工具调用可以自己换组），超限连树带组一起停掉并写原因（默认 128，最小 4）；双 fork + `setsid` 之后被过继给 launchd 的进程不在树上，这是已知边界；磁盘余量低于 1 GiB（`LODGE_MIN_FREE_BYTES` 可调）就不开跑。`settings.network: "none"` 的成员整轮不出网，没声明才走基座默认代理。**严格档**（`settings.profile: "strict"`）：HOME 换成回合里的一次性目录，读只给白名单（系统、引擎安装、工作副本、临时目录、钥匙串），钥匙串目录链回真实位置供登录；git 全局配置指向空文件。标准档与严格档共用同一个值和一个后端。**能力契约**：边界之内 node 可执行、`npm test` 离线可跑、git 状态可读；git 提交必须被拒（`.git` 只读，提交归平台）；**本地监听默认不允许**；只有声明的 MCP 提供方（本机回环 URL，比如电脑操作桥）按端口放行，端口从服务器声明里取，不另开一张网；其余 MCP 走 stdio；装包、浏览器预览、推送不在默认契约内，走“按成员声明”。**基准可执行化**：`npm run check:sandbox` 用 36 条真实系统调用断言定义“优秀”（标准档 + 负对照 + 严格档三遍）（读/写/连接/环境/信号/临时目录/静态入口），全绿才算达标；它跑三遍：沙箱开、沙箱关做负对照、严格档；关的那遍必须反过来（读得到、写得进、连得上），证明探针真的碰到了东西，不是读了个不存在的路径。它接进 `check:done`（macOS；其他平台如实跳过），红着就拦提交。
- **Windows 沙箱的参考实现（Claude Code / sandbox-runtime）**：官方文档现在仍写明“沙箱跑在 macOS、Linux、WSL2；原生 Windows 上命令不隔离”，原生 Windows 实现在开源运行时 `srt`（`srt-win.exe`）里，还是 alpha；Claude Code 2.1.311 的二进制里已带这套接线。做法：一次提权安装创建专用账户 `srt-sandbox`（一次 UAC），之后每个沙箱命令以该账户运行，会话期不再弹 UAC；网络用 WFP 过滤器按该账户的 SID 下发（机器级、按 sublayer GUID 隔离，端口范围与 loopback 必须和安装时一致，不一致就拒绝开会话；按 SID 过滤，装完不用注销）；文件边界用 NTFS ACL：profile 读授权但排除凭据库（SSH/GPG、云与浏览器登录、密码管理器、注册表 hive），拒绝项写成 deny ACE，清理靠 `srt-win acl recover`；进程再套 write-restricted token、Job Object 和 AppContainer。已知坑：Schannel 系的 TLS 客户端（`curl.exe`、PowerShell 的 `Invoke-WebRequest`、.NET `HttpClient`、`dotnet restore`、`winget`）在沙箱里连不上 HTTPS，官方说没有绕法；WFP 按 SID 匹配，系统服务流量和换 token 的进程不受管；读边界不隔离——任何沙箱会话都能读被保留的根；默认失败时降级成不隔离，要显式开 `failIfUnavailable` 才是 fail closed。可借的：网络策略按身份而不是按端口、一次提权安装、安装态与会话态的一致性校验、运行时放在可写范围之外。不借的：整份 profile 读授权（我们只需要成员自己的副本、回合临时目录和显式根）、默认 fail open（基座已经是 fail closed）、把 Job Object 当隔离（它只管进程树）。
- **失败诚实**：pi 把模型错误也按正常消息收尾（`stopReason=error`），基座把这种回合记成失败并带上原因，不当成空回复完成。claude 的 `result.is_error`、`subtype=error_*` 或 `stop_reason=error` 同样记失败；进程在给出 result 前退出时用 stderr 尾巴作原因，没有就写「claude 没有给出终态就退出了」。codex 只有 `turn.completed` 才算完成；`turn.failed`、顶层 `error` 后退出、或没有 `turn.completed` 的退出都记失败，原因取 error message 或 stderr 尾巴。注意：真实 codex 每次都会发一条 `item.completed` 且 `item.type=error` 的告警（例如模型元数据缺失），它不是终态，不能拿它把成功回合判死；只有退出时始终没有 `turn.completed`，才把这条 item 的 message 当失败原因。
- **claude v1 的诚实边界**：每回合 spawn 一次 `claude -p --output-format stream-json --verbose --tools "" -- <prompt>`（`--tools` 是可变参数，`--` 把提示词留给位置参数）。`--tools ""` 关掉全部工具，所以**没有工具面、没有审批卡、也不发内容增量帧**；v1 只用于聊天成员，**工作室请用 pi**。空 model 不传 `--model`，由 CLI 自己的 `~/.claude` 配置决定厂商与端点；环境经 `scrub_env` 清掉 `ANTHROPIC_*` / `CLAUDE_CODE_*`，密钥由 CLI 自己读 settings。沙箱、low-disk、时间预算、stderr 尾巴和进程组/看门人沿用 pi 这一套；标准档与严格档（`profile: "strict"`）都跑通真实回合——严格档的 HOME 是一次性目录，沙箱会把 `~/.claude/settings.json`、`.credentials.json` 和 `~/.claude.json` 拷进去，端点和登录由 CLI 从这份拷贝读，钥匙串照常链回真实位置。
- **codex v1 的诚实边界**：每回合 spawn 一次 `codex exec --json --skip-git-repo-check --sandbox <mode> -c ... -m deepseek-chat -- <prompt>`，cwd 是成员工作副本，外面照旧套沙箱、low-disk、时间预算、stderr 尾巴和进程组/看门人。`<mode>` 在基座沙箱存在时是 `danger-full-access`：codex 自己的沙箱在我们的 seatbelt / Job Object 里起不来（`sandbox_apply: Operation not permitted`），工具会全哑；边界归基座，codex 只当搬用工。没有基座边界时才退回它自己的 `read-only`。**没有工具审批卡、不计工具预算、也不发内容增量帧**。v1 只用于聊天成员，**工作室仍用 pi**。只接 DeepSeek：provider 配置由驱动写死（`wire_api` 只接受 `responses`），模型默认 `deepseek-chat`。凭据在 `~/.codex/deepseek.key`（权限 0600，内容是纯 key，可带一个尾换行）；基座读出、去掉尾部空白，**只给 codex 子进程**注入 `DEEPSEEK_API_KEY`（`command.env`，不进 `ENV_KEEP`，不全局设置）。文件不存在也照常 spawn，让 CLI 自己的错误成为失败原因。`CODEX_HOME` 指到回合临时目录，codex 的 session/日志不写真实 `~/.codex`。标准档已验证真实回合；严格档（`profile: "strict"`）下 codex 会在读自己的配置时报 `Operation not permitted`（沙箱不给读真实 `~/.codex`，也不该给——里面就是 key），所以 codex 成员请用标准档。
- **能力面决定成员能不能用**：`/api/instances` 的 `capabilities` 带 `tools`——pi 为 true，claude / codex v1 为 false。成员选的引擎不会被悄悄换掉：显式选择保留（聊天成员用 claude / codex 没问题，它们本来就没有工具，不存在“先问你”的问题）；要动手的工作室执行官落在没有工具面的引擎上，建房直接拒绝并说清「这一版还不能改文件、跑命令」，不降级、不换引擎。
- **房间权限（产品层）**：`shared/room-policy.js` 是三项设置的唯一来源——改文件（直接改 / 每次改动都问）、上网（模型 + 允许的网站 / 只连模型）、外部动作（高风险动作先问 / 直接做）。新房间默认第二列；策略决定成员是否要在基座停下来问（`approvalOf`）和用哪个出口代理（`networkModeOf`：默认白名单，或只放行模型厂商的第二个代理 `egress::provider_allowlist`）。审批桥按房间策略决定哪些卡停下来；保存时逐成员落到基座，任一成员失败就把已落的退回。旧房间没有 `policy` 时按它们实际运行的方式读，不拿新默认改写历史房间。**能落地的范围**：只有支持按成员收窄工具面的引擎（目前是 pi）才能把“直接做 / 只连模型”落下去；其他引擎继续逐次问，房间里有这类成员时“只连模型”直接拒绝，不装成已生效。外部动作的“先问”靠命令分类器认常见模式（推送、安装、删除等），不认识的脚本可能漏；要每一步都问，选文件那一组的“每一步都问我”。
- 已验证：一间真实工作室在薄基座上从规划走到交付（`room-f656468c`，见验收日志）；claude 驱动在真实 CLI（本机指向 DeepSeek 的 anthropic 端点）上跑通一轮 `Reply with exactly: ok`；codex 驱动在 `codex-cli 0.172.0` + DeepSeek `deepseek-chat` 上、默认沙箱内跑通一轮 `Reply with exactly: ok`。仍缺：claude / codex 的工具面与审批卡（v1 刻意没有，工作室仍用 pi）、用户级 `mcp.json` 隔离、Windows 沙箱的真机验证（后端已按专用账户 + WFP + ACL + Job Object 写进 `base-rs/src/sandbox/windows.rs`，见 [operations](operations.md#windows-基座进行中)；装好前 `box` 报 off）。
- **能力对照**：`server/base.js` 调用的每个端点（bots / groups / threads / events / instances / config / skills-library / mcp/servers / attachments / files）在 `base-rs` 都有实现；`server/base-slice.test.js` 的白名单即契约，新增端点是契约决定。

## 从旧基座借来的（值得抄的经验）

旧基座（OpenMausBot OSS）已从仓库与发布链路删除；它文档里的几条经验已经改写成我们自己的机制，留在下面备查（原文在上游仓库的历史里，不在本仓库）。

- **`--tools` 是替换，不是追加**：给 pi 传白名单会关掉名单外的一切，包括用来暴露 MCP 工具的 `codemode`。挂了 MCP 的回合必须把 `codemode` 带进名单（`base-rs/src/drivers/pi.rs`），否则成员能看见工具说明却调不到。旧基座的 pi 驱动自己挂 MCP，所以它的文档没有这个坑；我们用了 pi 内置 MCP，就得自己带。
- **名字不可用就是没选到，不回退成全部**：`native:*` / `mcp:server:tool` 选择器里，一个不存在的名字只代表没选到，不代表“那就全给”。基座的 `exclude_tools_of` 按这条翻译。
- **工具调用要落成事件**：Lodge 的判定靠活动消息里的回执（`submissionId`）取完整入参；只有文本流没有活动，房间就永远拿不到提交。`tool_execution_start/end` 要成对落，结束带 `ok` 与结构化回执。
- **模型错误也是正常收尾**：pi 用 `stopReason=error` 走 `message_end → turn_end → agent_end → agent_settled`，不看这个字段就会把 404 记成“完成 + 空回复”。终态必须带原因。
- **无副作用重试**：回合在**还没有正文、也没有工具调用**之前就断了（进程起不来、流中断、空转窗口到点），基座重发一次；退避 200ms 起、翻倍、±10% 抖动（对齐 Codex），重试在时间线上留一行“重试”活动。已经有输出或工具调用的回合不重试——重跑会重复写文件；被信号杀死的回合（用户中断、外部 kill）也不重试，那是有人要它停。pi 自己的 API 层重试（`willRetry`）仍由 CLI 负责，平台不叠第二层请求重试。
- **预算归产品，执行归基座**：数字（工具调用数、墙上时间、空转窗口）由 Lodge 在 `shared/turn-budget.js` 声明，基座缺声明时用安全默认并执行，终态写清为什么停。旧基座的 `runtime-contract` 还给了无进展止损的规则：连续两次没有成功工具调用、或同一错误三次，判 `stalled`；我们暂时把语义判断留在 Lodge 的 `progress.js`，基座只计数和看表。
- **轮次字段只能用 `updateRound` 写**：`updateRoom` 会拒绝 `ROUND_FIELDS`（usage、openQuestion、stages…），在事件回调或 attach 里抛错会把房间打断。已经踩过两次：聊天室 usage、工作室暂停时清 `openQuestion`。能写成回归测试的就写成测试。
- **重启路径要真的重启一遍**：房间 attach 失败只会在启动日志里出现一行，随后无限重试；一次真实的“杀进程再拉起”比十次单测更能抓到这类状态错层。
- **探测不等于可用**：`pi auth check` 只证明有凭证；模型请求仍可能 404。报告里写“探测到登录”而不是“可用”，并且把真实请求当唯一证据。
- **验收的通过条件要能被拒绝**：PASS 的 `falsify` 命令必须在复核副本里跑通；找到反例还判 PASS 要被拒。覆盖表的 `item` 要求原样抄契约，模型改写就会被拒——这两条都在真实工作室里拦住过不成立的通过。
- **停下来的回合不是交付**：digest 投影带基座的终态（`stopReason`），房间据此分路；被停下/失败的回合不写结果证据、不进复核。超时也不只是改状态：阶段截止和成员租约到期调用中断，把成员的回合真的停掉——否则“已停下”只是状态层的一句话。
- **复核超时量沉默，不量干活**：复核定时器每到一个窗口先看验收员在这段时间里有没有自己的动静（工具活动、回答），有就重新起算；真静满一个窗口才结束这一拍。验收员跑一条三分钟的命令不该被当成“没回来”；它自己的回合另有基座预算兜底。
- **PASS 撞上不能重跑的证明是退回，不是等人**：交付的 `lodge-proof.json` 重跑失败时，验收员的 PASS 不成立，按验收退回走同一条返工路直接送回执行官（带上干净副本里的真实失败原因），房间不停在“等人点重试”。
- **复核与签收必须用同一套通过条件**：这次真房出现过“复核员判了 PASS、签收却拒绝”：签收要求 `proof.status = verified`（交付带能重跑的 `lodge-proof.json`），复核只重跑“已有的证明”，没有证明时等于零条、直接放行。现在复核在 PASS 前也看同一个状态，缺证明就当场拒绝，并说清“先让执行官补 lodge-proof.json”。一份事实只能有一个判定入口。
- **通过的判定不能被暂停闷死**：房间可能在等复核时被“连续无进展”暂停；判定到达后如果只是收口失败，房间就永久停在“已通过却收不了口”。复核通过先恢复暂停（`resumePausedForReviewPass`），系统收口失败要落一条系统消息，不能 `catch(() => {})` 吞掉。
- **失败的 attach 要拆干净**：attach 半途失败只标记断线，会把已建好的订阅/SSE 留在后台；每 30 秒重试一次就多留一批，实测一个进程攒了 200+ 条 CLOSED 连接。失败路径先 `detach` 再标记。
- **关闭必须有期限**：收到 SIGTERM 后 `server.close()` 已经执行、`app.stop()` 却卡在订阅上，进程会变成“监听了已经关掉、还占着端口”的僵尸。`shutdown` 用 5 秒上限兜底，到点照常退出。
- **诊断先读账本**：两次把已经正常收尾的回合当成“卡死在模型请求”——一次是 `codemode` 被关掉（规划师自己在 digest 里写了原因），一次是复核接口传错了阶段序号。终态、digest、stage 状态都在库里，先读再下结论。

**不要照搬的部分**：team cloud、phone、composio、meeting、例程这些宽度是它服务多个产品换来的，Lodge 不用。复用其代码要保留 Apache-2.0 的 `LICENSE`/`NOTICE`。

### 旧基座文档里已经写明的坑（我们不必再踩一遍）

下面每一条都出自它自己的文档，括号里是出处；右边的“我们的对应”是已经踩过或写进机制的。

- **验证只在隔离环境动**：`AGENTS.md` 写明先在隔离夹具里验证，绝不拿用户的真实应用和数据做写操作。我们踩过：`check:done` 的端到端 Lodge 连上了 8798 的真实薄基座，把房间的 bot/群清空。
- **一条规则要落进类型、测试或 lint**：`AGENTS.md` 的注释规则说，需要一段话解释的“意外”应该改代码；规则放类型/测试，不写进提示词或注释。对应我们的“能落成门禁的不靠自觉”。
- **崩溃循环要收敛成一次事故**：`docs/team-incidents.md` 给重试上限（同一线程重试两次，第三次停下解释；一小时五次后静音）、迟到报告不能重做已经完成的工作、停掉的工作不算事故。我们踩过：复核超时 → 重做 → 又把旧证据送审，反复循环。
- **终态只写一次，唤醒只看终态**：`docs/runtime-contract.md` §2。我们已按这条做（`claim` 一次终态、`turn.completed` 只是投影）。
- **无进展止损的规则**：`docs/runtime-contract.md` §2——连续两次没有成功工具调用、或同一错误三次，判 `stalled`；执行预算才是兜底。我们只做了计数预算和墙上时间，规则留给 Lodge 的 `progress.js`。
- **同一对话的回合不重叠，子任务只能向下派生**：`docs/runtime-contract.md` §2（拒绝把工作派回祖先、同请求去重）。我们已有 per-thread 互斥；去重留给 Lodge。
- **工具选择器语义**：`docs/tool-selection.md`——名字不可用就是没选到，不回退成全部；Allow/Exclude 的边界各有上限。已在基座的 `exclude_tools_of` 里照做。
- **读自己的文件不问人**：`docs/approval-levels.md`——bot 读自己的说明书、技能、记忆和对话目录永不弹卡；别的都要显式授权，Full access 下请求方可以替人回答。我们的审批卡还没做到“按自身目录自动放行”，先记下。
- **沙箱只给这一回合该看见的**：`docs/bot-box.md`——只有工作目录和 bot 自己的目录、私有 `/tmp`、别的 bot 的数据不存在；依赖 CPU 计数的程序会因 `/sys` 缺失自杀（exit 134）。我们的 macOS 沙箱按这条收边界；第二平台是 Windows（Linux 不做），Windows 后端还没做，`box` 字段如实报 off。
- **暂停是一个开关，拒绝要说怎么恢复**：`docs/pausing-bots.md`——暂停立即停掉所有在做的事，新工作被拒绝时写明“已暂停、如何恢复”，不静默丢。我们的“无进展暂停”目前只写一句“可以接着聊”，还没做到逐条交代。
- **钱按回合结算一次，封顶从内存判断**：`docs/verification/spend-cap.md`——回合一旦 settle 就计费，不能因为落库延迟重复记账；到顶后所有入口一律 409。我们的用量只有基座一份账本，还没做封顶。
- **界面和文案的硬规则**：`DESIGN.md`——安静、说人话、每个状态都要设计、不新增设置、不新增打断、借感觉不借形式。和 `docs/design.md` 同一条思路。
- **本机只监听回环，变更要有一次性能力**：`SECURITY.md`——服务只绑 127.0.0.1，公开变更需要桌面每次启动的能力令牌或配对会话。我们目前同样是回环 + action token。
- **不做**：把房间规则塞进基座；为了性能重写模型协议；为了对齐上游去补基座用不到的功能。

## 从 Antigravity 2.0 对照来的

Google Antigravity 2.0（2026-05）是同一类机制的另一份实现：桌面编排台 + CLI + SDK，动态子 Agent、`/swarm`、`/teamwork`、每个子 Agent 独立 worktree、审批冒泡到父会话。只取机制做对照，不取分层。

- **它有的，我们已经有**：子 Agent 生命周期（回合终态 `completed/stopped/failed/expired`，中断有终态，重启把 running 补成失败并写原因）、fan-out 汇总（工作室并行工作包用 `allSettled`，失败暂停房间而不是假装完成）、每成员独立工作副本（外加 seatbelt、每回合引擎目录、出口代理）、审批分层（房间三项 + 角色权限 + 外部动作分类器）、逐条工具活动与用量账本。
- **审批超时不借**：它的模型是“等人审批 / 超时到期”两种终局；我们的超时只暂停房间、卡保持 pending，人回答后原地恢复，先答后超时与先超时后答各只生效一次（`server/crew/approval-bridge.test.js`）。超时替人拒绝等于平台替人做决定，不采纳。
- **唯一待证实的差异**：它的并行项一个失败会取消兄弟；我们是一个失败暂停房间、兄弟把自己那一回合跑完。差别是暂停后是否继续烧 token。按摩擦账本处理：真实房间出现兄弟回合在暂停后继续跑，再改；改之前先把“取消兄弟”的语义定清楚（取不取消、取消写不写失败终态、算不算房间失败），不顺手抄一行 `Promise.race`。
- **不借的**：产品/harness/编排/模型一体的分层（我们的边界是基座只管会话，编排留在 Lodge）；跑编排脚本前逐份人工批准（我们的契约是人只事后否决）；绑定单一厂商、闭源的 SDK。

## 数据与真相

- SQLite `room` 存长期工作室、成员、工作区和 `idle/active/paused/stopped`；`work_round` 存一轮的目标、计划、阶段、门、决策、费用、预算和交付；`project` 存轮次分组和北极星。
- `messages` 存时间线并带 `work_round_id`；`work_round_id=NULL` 是房间级消息，当前视图会带上它，旧轮详情只读该轮。工作室消息写入时归到当前轮，轮次结束后到达的消息归最后一轮；聊天室保持房间级连续。证据和结论都是消息。
- `room_event` 存结构化轮次/运行时事件，带 `idempotency_key`；`assignment` 存房间内交接并带 `work_round_id`。旧轮和新轮在存储上就分开。
- `work_item` 是唯一的持久队列和唯一的时钟：定时、审批、阶段截止、重试和恢复都走它，带 `attempts/max_attempts/available_at/lease_until/dedupe_key/last_error`。`enqueueWork` 是唯一入口，同一个 id 再投一次表示重设到点时间；轮次结束时同事务作废属于该轮的待办，领取过期后按退避重试，耗尽即死信并通知人。
- 调度器不认识房型：到期项交给 `live.handleWork`，房型按 `kind` 处理自己的活（`approval`、`stage.deadline`、`chat.round`）。新增一种长期动作只需注册一个处理器，不改调度器和存储。阶段超时同时有内存计时器保证准时和持久截止项保证重启后仍会到点；房型换轮或阶段已结束，迟到项是安全的空操作。
- 聊天室也有持久时钟：一轮讨论进行时占一条 `chat.round` 工作项，`chat.turns` 落了已发言次数；进程重启后从下一次发言续跑，不把整轮从第一句重来。发送前先落 `chat.pending`（第几回合、谁、之前的消息 id）；重启时用它在基座历史里找已经到达的回复，找到就补账，找不到只记一次未回应，不重发。
- 交接租约也走同一条队列：assignment 进入 `sent` 时落 `assignment.lease`（8 分钟）；成员出现第一个活动（工具调用）或交回第一个非空回合后就取消这条计时，后面的长回合交给阶段截止兜底。一个成员一直没有任何活动才在租约到期时只停这一位；还有别人在跑就继续等，最后一位停下才收口。阶段截止（15 分钟）保留为整步兜底。
- 存储拆成 `store/` 仓库：`work.js`、`rounds.js`、`timeline.js`、`assignments.js`、`projects.js`；`store.js` 只做打开、组合和房间视图。房间写入和轮次写入是两条显式路径：`updateRoom` 只写房间自己的字段，`updateRound` 才读写当前轮次；终态轮拒绝写入。轮次字段清单在 `shared/work-round.js`，两边共用。开新一轮时轮次和用户消息在同一个事务里落库，收口时结论消息和轮次完成也在同一个事务里落库；启动失败可以安全恢复。HTTP 动作按动作族放在 `actions/room/{lodge,run,admin,round}.js`，`room-actions.js` 只做分派，`service.js` 只做组合根。
- `SCHEMA_VERSION=8`；版本不一致直接拒绝启动，运行 `npm run data:reset` 重建。旧数据不迁移、不留兼容字段；同一份状态只有一套读法。
- 历史检索是房间自己的索引：`message_fts` 在消息追加/更新时维护；`searchMessages(roomId, query, {limit, before})` 只在本房间查，跳过活动噪声。规划师最多拿到 4 行只读简报，命中的消息 id 记 `history.brief`，只作参考，不是新指令。
- 基座幂等键 `meta.baseId` / `meta.sendId` 有表达式索引；流式收口和回显对账按 id 查一条，不再为了去重把整间房读进内存。长聊天的成本随新增消息增长，不随历史总量平方增长。
- 房间目录 `transcript.jsonl` 先追加并 fsync，再写 SQLite；轮次级目标、结论和证据文件可重建。
- 当前用户是全局资料（`profile` 表一份），房间展示和 agent 上下文从它读，不再各存 `humanName`；改昵称后下一次快照即全局生效。
- 一轮完成只结束这一轮：工作室回到空闲；下一轮在同一工作室开，旧轮保留为可回看的轮次。
- 没有全局成员表，也没有全局 Assignment 表；成员和交接跟着房间走。证据与 verdict 正文留在消息里，Assignment 只存引用。
- 记忆只存指针和结论：目标、结论、改动文件路径、退回理由和 commit；不存文件正文、附件内容或 `.env`，写之前统一脱敏。
- 秘密脱敏走 `shared/secrets.js`：提示词经 `sanitizeUntrusted`，证据在入库前，记忆在写入前，日志经 `server/crew/log.js`；`systemNotice` 只把人需要看的一句写进时间线。
- 规划师和验收员的只读副本永远不含 `.env`；执行官才拿本地环境。普通目录、git worktree 和原地目录三条路径都有测试固定。
- 通知只给真正等人处理的事：进度、重试和后台建议不弹；同一间房 5 分钟内不重复，规则在 `shared/quiet.js`。
- 存储实现可替换，但业务真相必须落在支持约束与事务的持久存储。

## 状态图

```text
房间  idle / active / paused / stopped / archived
  └─ 轮次  planning → active → completed / rejected / failed / superseded / stopped
       ├─ 工作室  阶段 pending → active → passed
       │            └─ 交接 created → sent → working → reported → reviewing → passed / rejected / failed / cancelled
       └─ 聊天室  discussing → summarizing → concluded → discussing
```

- 三层是事实：房间、轮次、房型状态。`stageStatusOf` 的 `blocked/waiting` 和注意力里的“等你处理”是派生，不是第四层。
- 房间主时间线只有三个角色的消息和结果卡；系统交接、阶段回执和完成记录留在后台账本，不作为成员发言展示。规划师每轮用自然中文说计划：先结论，再按格式分点（下一步和交给谁 / 怎么算过 / 做完是什么样），不套模板标签；正常派活由系统私下投递，不再叫规划师重复一句话。
- 注意力只列真正等人动手的事：审批、提问、阻塞、冲突、退回、超时和规划师交给人处理。`review`（验收员在看）和验收通过后的 `signoff` 只是进度，带 `actionable: false`，不进入待处理队列、不弹通知、不把灵动岛变成“等你决定”。验收通过不再需要人确认。
- 轮次终态不回退；退回是重新打开阶段或新建交接，不改终态记录。
- 工作室的验收通过/退回、交接的下一棒由 `relay.js` 决定；聊天的阶段转换由 `rooms/chat/state.js` 的表决定。
- 读模型只在 `shared/room-status.js` 和各房型自己的状态模块；界面不拼状态。岛的状态映射见 [design.md 的「灵动岛」](design.md#灵动岛)。
- 共享状态不是一个大对象：`shared/states.js` 定义值，`shared/room-status.js` 用一组纯函数回答“房间在哪、轮次在哪、现在是否已交付、这一步/聊天在干什么”。消费者按问题取，不拿一份包含所有字段的快照；`presentRoom` 只组合投影，不复制状态。
- 这样做的代价是消费者可能组合错（比如把历史交付当成当前交付）；用状态目录、单一读模型和测试约束，而不是靠一个万能对象兜住。
- 加成员只影响之后的派发和复核；当前阶段的 assignees 和在跑的复核轮次固定，规划师唯一且不能移除。

### 状态是投影：单写者、不变量、影子

- **真相是事实**（消息与事件），`stage.state`、`round.status` 是它们的投影；从时间线能反推“这一步到底有没有结果”。
- **单写者是存储**：`store.updateRoom/updateRound`。所有入口都从这里落库；组合根注入 `roundGuard`，在 mutate 之后、提交之前跑（`server/crew/rooms/studio/runtime/state-guard.js`）。
- **不变量**：至多一个 active 阶段；终态轮次没有 active 阶段；方案的每个阶段落到轮次；至多一个规划师；电脑工作区至多一位执行官。
- **影子投影**：已通过的交付阶段必须有这一步的 `evidence` 事实；不一致记 `state.violation`，不复制复核逻辑。
- **示例房是夹具**：`demo: true` 的房间不参与判定。它的状态是给人看的样例，没有引擎维护、也没有结果证据；用真实房间的不变量判它，只会让新用户第一次打开就看到坏房。真实房间照旧严格。
- **模式**：默认 strict（回滚并抛错）；`LODGE_STATE_GUARD=shadow` 只记事件和日志、不拦，用来排查一条告警是不是真的。
- **拒绝要有出口**：非法转移必须是一个返回值或一条消息，静默 `return` 不算；能同步判定的让 gate 工具直接回给模型。
- **边界**：不变量只守我们想到的规则；它把“错得无声”变成“错得可见/写不进去”，不保证零错误；外部失败（工作树被删、基座挂掉）仍在。
- **基座不参与**：房间状态机属于 Lodge；基座只有回合生命周期。
- **下一步**：业务命令目录（`submit_plan / rework / verify / signoff` 收成一张数据表），gate 工具同步返回拒绝；strict 下的违例先补成测试或门禁，不靠“下次注意”。

## 轮次生命周期

- 状态：`planning | active | completed | rejected | failed | superseded | stopped`。终态不再回退。
- 同一房间最多一个 open round（数据库部分唯一索引）；`room.activeRoundId` 为空或指向 open round。
- 开始、完成、停止、退回、失败、作废都走同一条事务：更新轮次、清 `activeRoundId`、设 `lastRoundId`、房间回 `idle`，再写事件。
- 完成要求所有阶段 passed 且没有未终态交接；失败只结束这一轮，不把房间变成终态。
- 房间暂停不改变轮次状态；恢复继续同一轮。归档先停止 open round，再设 `archivedAt`；恢复回到 idle，不重新打开终态轮。
- 运行时按 room+round 生命周期创建和释放；停止、完成、归档、删除都会清掉 stage timeout、自动重做和待确认卡。`rooms/studio/runtime/turns.js` 只做装配，结果收集、规划师决定、回合采集和重启续跑分别在 `rooms/studio/runtime/` 的四个模块里。
- 状态读模型：`roomStatusOf` 只返回 `idle/active/paused/stopped/archived`；`roundStatusOf` 管轮次；`idleDelivered` 表示当前是否已交付；`stagesCompletedOf` 表示所有阶段是否已经走过；`stageStatusOf` 把阶段状态和阻塞、待回答、待拍板收成一个词；`chatStatusOf` / `chatStartedOf` 把聊天阶段、运行标志和首条发言收成一个词。界面和记忆写入都只读这些函数，不自己拼状态。
- 状态目录：`shared/states.js` 是唯一清单，收拢房间、轮次、阶段、交接、聊天、work item、审批、复盘记忆、注意力和交接消息等状态与转移表；服务端和共享层的状态读写都从这里取常量，`shared/states.test.js` 还会扫源码，防止裸状态字符串回潮。
- 事件覆盖：轮次开始/终态、阶段派发/通过/重做/退回、交接的每次状态变化、聊天的每次阶段变化都写 `room_event`；`round.started` 带阶段快照。事件只做审计和重放，不回写业务状态。
- 只读重放：`npm run replay:round -- --room <id> [--round <id>]` 从事件重建阶段和交接状态，和当前数据库对比；只报告差异，不改状态。实现见 `server/crew/rounds/replay.js`。聊天室用 `npm run replay:chat -- --room <id> [--round <n>]` 把 `chat.round_started / speaker / summary_started / conclusion / continued` 和消息串起来，回答这一轮谁说了什么、结论从哪来；重启补账事件只进事件流，不参与重放；实现见 `server/crew/rounds/replay-chat.js`。

## 两种“交接”

- **交接简报**：聊天结论进入工作室的输入，字段是 `handoffBrief`（主题、共识、分歧、未定、约束、待办）；建房请求和房间记录都用这个名字。它不是房间内的成员接力。
- **工作拍**：房间内的一次派活，持久对象是 Assignment；Handoff 指“把这一拍交给谁”的动作，`handoff` 消息只是它的界面投影。验收员各自算一拍；交给人的 `handoff.human` 不算工作拍。

## Assignment

发起人、接收人、阶段、原因、brief、状态、结果、证据引用、裁决引用、父交接、时间戳。

- 接收人是房间成员；同 id 对应同一次交接，重复创建返回原记录，不覆盖证据。
- 状态链：`created → sent → reported → passed`，另分 `failed / rejected`；只通过一个 transition 入口改，校验和写入同一事务；终态不回退，唯一例外是送达失败（记录上 `deliveryFailed` 为 true）：同一拍重新投递成功后回到 `sent`，不新建记录，重试前清掉 `finishedAt`、上次错误，并用这次传入的 brief/context 更新账本；工作失败不能走这条路。
- 交接原因：`dispatch / rework / retry` 是工作交接；`review` 是执行官交给验收员复核；`summary` 是验收通过后交给规划师收尾；`decision` 是退回后交给规划师做例外决定。
- 人不是房间成员：交给人的交接写 `handoff.human` 事件，不硬塞成 Assignment；交接事件里带 `reason` 和 `actionRequired`。
- 复核轮次在发起时把验收员固定到 `stages[i].reviewers`；之后加验收员只影响下一轮，不回头要求新成员对上一轮的证据补判定。
- 加成员只影响之后的交接：只能加执行官或验收员，规划师唯一且不能移除；当前阶段的 assignees 和在跑的复核轮次不改；有未结束交接的成员不能移除。
- 派发状态和阶段任务从 Assignment 现算，不写回房间；交接卡按 id 找记录，按引用取证据。
- 返工指向被退回的那条；复核指向被复核的执行；收尾和例外决定分别指向刚才那条复核。
- 历史分页 `GET /api/rooms/:id/assignments`；每房保留最近 2000 条终态交接，未收口的不清理。
- **webhook 入口**：房间动作 `webhook`（enable/rotate/disable）把令牌写在房间上；`POST /api/webhooks/:room/:token` 是唯一不走桌面动作令牌的写入口，鉴权就是那个令牌（常量时间比较），按 `id` 幂等。消息作者是 `webhook`（界面显示「外部事件」）；聊天室因此接话，工作室只记录。

## 状态与事件

- **真相是状态表，不是事件流。** 房间、轮次、阶段、交接、聊天阶段、work item、审批都是显式状态；`room_event` 是追加日志，用于审计、幂等和重放，不用来重建全部状态。这不是完整的事件溯源。
- **事件覆盖**：房间创建、暂停/恢复/归档/成员错误，轮次开始与终态，阶段派发/通过/重做/退回，交接的每次状态变化（含复核、收尾、例外决定），交给人，复核请求/判定/超时，结果证据，自动重做停止，聊天阶段变化、总结和重启补账（`chat.turn_recovered` / `chat.turn_missed`）、历史简报（`history.brief`，只记命中的消息 id）。
- **没有做的事**：没有 command/projection 两套写路径，没有事件版本与 upcaster，没有事件级快照；事件保留上限 5000 条，旧事件会被裁剪；交接事件在状态提交之后写，写失败只警告、不回滚业务状态。
- **重放范围**：`npm run replay:round` 只重建工作室一轮的阶段状态和交接状态，不重建消息正文、verdict 内容或证据文件；`npm run replay:chat` 只把聊天轮次事件和已落库的消息对成时间窗，回答谁说了什么、结论从哪来，不判断结论对不对，也不重跑模型。`round.started` 带阶段快照；没有快照的旧轮次只能重放交接并给出 warning。两种重放都只读，不改写状态；缺失的结论或发言只报 warning，不补造。
- **项目状态**：project 只是轮次分组和北极星，没有独立生命周期；它不参与门禁、不执行、不验收。页面上说的“进行中/已交付”是最近一轮的轮次状态，不是 project 状态。project 记录里没有 status 字段。
- **扩展路线**：如果“可追溯”成为产品需求，只对轮次生命周期做事件溯源（事件成为写入口，补事件版本和快照），消息、证据和交接仍保持状态表；不把整间房的数据改成事件流。

## 后台队列

- 后台动作只有一张表：`work_item`。定时、审批超时、阶段截止、交接租约和聊天轮次都写这里；没有第二套 timer 表。
- 先落库再执行：调用方写入 `work_item` 后才返回；处理器由 `rooms/scheduler.js` 领取。`id` 必须稳定；需要按来源去重时传 `dedupeKey`。没有 `dedupeKey` 时，同一个 `id` 再投是重设到点时间，会重置 attempts。
- 当前生产入口：
  - 审批超时：`approval.id`
  - 阶段截止：`deadlineIdOf(stage)`
  - 交接租约：`assignment-lease:<room>:<assignment>`
  - 聊天轮次：`chat-run:<room>:<round>`
  - 常驻承诺：`promise.tick:<room>:<nextAt>:<version>`
  - 邮件投递：`email.send:<room>:<round>`
- 每房单活、房间之间并发：调度器用 `running` 集合占住房间，慢聊天不会挡住别的房间的审批或截止；租约 60 秒，过期回收，失败按 1s→300s 退避，最多 3 次。
- 还没进队列：webhook、基座 routines 和邮件投递尚未接线；Lodge 自己的常驻承诺见下一节，已接工作室、每周/每天；用户消息和直接 `@` 是请求路径，不是 `work_item`。聊天靠 `chat.pending` 和 `chat.round` 续跑，工作室靠轮次、Assignment 和阶段截止续跑。
- 新接一个外部来源时，先给它稳定的 source id；没有稳定 id 就用 `dedupeKey`。不要为它新建第二张收件箱或计时器表。

## 常驻承诺（定时）

定时不是一张 routine 表，也不是第二个调度器；它是房间上的一件“说好的事”，复用同一个 `work_item` 时钟和普通轮次。对外叫「说好的」或「每周给你」，代码里是 `room.promise`。**当前只支持工作室、每周/每天、本地时间、一个房间一件。**

- 形状：`room.promise = { text, schedule: { every: 'week' | 'day', weekday?, at }, delivery: { channel: 'room' | 'email', to, mode: 'always' | 'changes' }, status: 'active' | 'paused' | 'stopped', nextAt, runs, misses, lastRunAt, lastRoundId, lastRunStatus, lastChange, version }`。`text` 就是下一轮的目标；`delivery` 只是一次投递，不改变轮次。
- 到点：`work_item` 里一项 `promise.tick`，id 带 room、nextAt 和 version；到点启动一轮普通轮次；开跑前再读一次版本，用户暂停或改口就不开。同一时刻只有一项 tick，房间忙就不开，不排队也不并发。
- 忙、暂停或房间停着：这一期跳过，记 `promise.skipped`，不排队；下次到点再来。关掉应用错过的到期项，下次打开补一次，并在房间说一句「这一期是补上的」。
- 连续没开起来：跳过和启动失败都记一次 `misses`，成功开跑清零；连续 3 次没能启动就把承诺置为 `stopped`，不再排下一期，房间说一句「这件事停了；要跑就重新开始」。人重新开始是一段新的连续计数。
- 启动失败：记 `promise.failed`，不重试同一期；排下一期，并用一句人话说没开起来。
- 归档 / 删除：归档把活动承诺置为 `stopped`（`stoppedReason: 'archived'`）并取消已排的 tick；删除同样先取消 tick。取消归档不会自动恢复，要人按「重新开始」。
- 控制：现在跑一次（同一条 tick，`manual`）、暂停/恢复、改一下、不做了；恢复和改口都会重新算下一次。
- 对比：一期交付记一个内容指纹（结论 + 文本产物 + 文件路径），记 `lastChange = first | yes | no`；卡片说“第一期 / 上次有变化 / 上次没变化”。指纹不含轮次 id，同样的内容跨轮仍算没变化。
- 邮件投递：承诺的 `delivery.channel === 'email'` 时，一轮交付后平台排一条 `email.send:<room>:<round>`（dedupe 同 id），正文优先取这次产出的文本，其次取结论和文件路径；发件箱是 `work_item`，重试 3 次，成功/最终失败都记在承诺上。`mode=changes` 时，没变化不发，只说一句“这次和上次一样”。地址和密码来自设置界面的 `~/.lodge/smtp.json`（600）或 `LODGE_SMTP_URL` / `LODGE_EMAIL_FROM`，不进房间、不进提示词；设置接口只回连接状态和发件人，不回密码。
- 本地时钟：由 `rooms/scheduler.js` 领取；关掉应用不跑，下次打开补一次；没有后台常驻，也没有云。准点送达要后台代理，目前不做。
- 边界：只在工作室；承诺不能绕过审批、预算和外部动作门禁；主观任务仍靠第一期人看，不假装客观。YouTube/GitHub 的“找什么”由这一轮的目标和成员的只读网络工具完成；平台不另建趋势 API，也不把来源写死。
- 下一步（未做）：轮次间对比、连续无变化自动停、发现重复后提议、后台常驻。先跑真实一周，记做到率、有用率、想停率、每期成本，再决定加什么。

## 执行与验收

验收和权限的规范性判断卡在 [agent-design.md](agent-design.md#判断卡)；这里只讲它们怎么走。

- 规划师派发给执行官；证据就绪后系统请求验收员复核。默认接力由 `server/crew/rooms/studio/delivery/relay.js` 决定：验收退回直接交回执行官；通过时中间步骤自动收口并派发下一步，最后一步交回规划师收尾；只有重做预算用完、合并冲突或没有可执行官时才回到规划师/人。
- 验收通过即完成：中间步骤自动推进，最后一步由界面自动确认（`rooms/studio/plan/auto-accept.js`，400ms 后走 `accept`），不需要人再点确认；`accept` 仍会重跑 `gateFor`（结果证据、证明、全部验收员 PASS）。PASS 必须带覆盖、重跑的证明、反例和 diff 外的风险；工具没挂上时这些字段从文本 json 读，平台照常执行和核对，缺一项就不通过。房间字段 `autoDeliver` 只影响没有界面自动确认的调用方（例如承诺任务）。门禁不满足就交给人处理。
- 工作室成员的立场是角色定义上的稳定字段（`ROLE_DEFINITIONS.stance`），提示词展开、界面可读，不靠每轮临时编一句；成员的项目经历不另存，交接包里从房间已有的证据和判定回看“你在这个房间的经历”，事实仍只有房间一份。
- 工作室只有一个共享房间：派发、复核、退回、通过都由系统在群聊发一条带 @ 的投影；投递不依赖模型点名。两种房间建房时都在基座写 `followMentions: false`，成员回复里的 @ 不再唤醒下一棒；聊天室先保证今晚请到的人各说一次（一轮默认今晚人数 + 2 次发言），再按立场互补。提示词投递走成员自己的执行线程：并行派发一直是，盲评复核现在也是；群聊只留一条可读的 @ 投影，验收员不会被执行对话污染上下文。
- 用户停下回复走 `interrupt`：取消当前回合和未终态交接，房间保持 `active`；不写 `pauseReason`，也不要求再点继续。
- 平台在每步交回时收集结果证据：候选人提交、diff、改动文件和执行官的结果说明；验收员在自己的只读副本里自己找证据、读文件、跑检查。没有结果证据就不进入复核。
- 执行官只写自己的工作包：平台按派发顺序把人对应到包（一个执行官时拿走该步全部包）。工作包同时是写边界和证明边界的唯一依据：规划师提交的方案里每个阶段至少一个包，每个包必须写清要改的文件和它负责的 `clauseIds`；阶段里的每条契约要求都要落到一个包，否则方案被退回。回合结束后在 git 工作副本里把包外的改动退回去，并在时间线留一句；越界事实写进结果证据的 `meta.outOfBounds`，验收员能看到。证明文件不属于任何包：并行阶段每个包写自己那份分片（`lodge-proof/<n>.json`），根目录的 `lodge-proof.json` 是**阶段证明**，由平台合成（见下）；执行官提交候选前，平台会把它误写在根目录的证明挪成它这一包的分片（内容相同就去重，不同就留成附加分片），所以两个包永远不会在同一个路径上写。复制目录和原地目录在阶段起点记文件清单，交付时做差检测包外改动；它们没有可回退的版本，所以包外改动会直接挡住确认，等人处理。
- 验收员的证据只能来自自己的复核副本：PASS 的工具调用如果指向别人工作树或集成目录，判定会被退回重问。读边界现在更早生效：群里每出现一次工具调用，房型守卫就核对一次路径，读到别人的工作副本会立刻叫停这位成员的回合（`engine.interruptBot`）并把这一轮标成 `blocked.reason = read-boundary`；回合结束时还会再对账一次。macOS 上应用启动的基座默认带 `OMB_BOT_BOX=1` 和 `OMB_BOT_BOX_DENY_SIBLINGS=1`（`electron/launch.mjs:baseBoxEnv`，用户显式设 `OMB_BOT_BOX=0` 时尊重用户）：数据目录不可读、自己的副本可写，工作目录的兄弟目录（同房间其他成员的副本、集成目录）由 profile 显式 deny；源仓库在房间目录之外，仍可读，由平台读边界兜。想连 HOME 也只读，再加 `OMB_BOT_BOX_HOME_READONLY=1`。设计见 [plans/sandbox.md](plans/sandbox.md)。
- 交付自带证明：只有一件事——一条能重跑的命令。单包阶段写根目录 `lodge-proof.json`，并行阶段每个工作包写 `lodge-proof/<n>.json`（执行官提交候选前，平台把它误写在根目录的那份挪成这一包的分片，两个包不会写同一路径）。结构是 `{ "entry": "命令", "steps": ["额外命令"] }`；**不带 clause 语义**，证明不对账契约要求——要求有没有被覆盖由验收员的覆盖表负责，证明只回答“这份交付能不能重跑”。平台在一次性副本里原样执行 entry 和每条 step（超时 120 秒，环境去掉密钥变量，输出脱敏）：全绿是 `verified`，任何一条红是 `failed`，没有证明是 `missing`，格式不对或引用成员私有目录（`.lodge/`）是 `invalid`。根证明和分片各自跑一遍，**不合成入口脚本**，所以不存在“证明的入口再调证明”这类自指。行为要变的步骤（`behavior: change`）还会在阶段起点跑一次 entry：改动前也绿记 `weak`（没有绑定这次改动），改动前就红才是它应有的样子。结果随结果证据入库为 `meta.proof`（`status`、`entries`、`steps`、`weak`、`behavior`），交付卡只显示入口和「已证明 / 未证明」。证明的辅助脚本必须随交付走（例如 `tools/`）；`.lodge/`、临时目录和工作区外的文件不随交付走，干净副本里没有它们，证明引用它们会被判 `invalid`，房间会带着真实原因让执行官补。
- 证明要绑定这次改动：平台把同一份证明在阶段起点（`stageBases[stage]`）的副本上再跑一次。阶段默认 `behavior: change`，证明在改动前也必须失败；前后都绿的证明标记 `weak`，不能确认。重构或保持行为不变的步骤由规划师标 `behavior: preserve`，这时前后都绿才是对的。
- 验收员只负责判断和补刀：**证明由平台在验收员自己的复核副本里重跑一次**（`review/request.js` 调 `runProof`，`behavior: preserve` 只问“能不能重跑”），结果作为交付事实进判定；不再要求模型把命令原样再打一遍——重跑是副作用，归平台，模型只读结果。每一个 PASS 都要提交至少一条反例命令（工具可用时在 `submit_verdict.falsify`，工具没挂上时在文本 json 的 `falsify`），由平台在复核副本和阶段起点各执行一次，两次结果都记进判定（`falsifyRuns`）。平台只认一种事实：命令在交付上跑红就是反例。两边都绿不否决——验收员可以自己构造两边状态（先 `git archive` 旧版本再补上新检查），那样的命令本来就该两边都绿；“这条命令够不够狠”是验收员的判断，记录给人看，不替它裁决。保持行为的步骤（`behavior: preserve`）反过来：改动前就红说明旧行为已经变了，同样是反例。缺反例、缺风险、缺覆盖都按不通过收口，不因为走文本就放行。
- 复核提示不只看 diff 尾巴：改动从开头给到 32k 字符，文件清单最多 200 个；超出的部分明确标出来，让验收员在副本里按文件读全文。判定必须有亲手验过的工具痕迹，读一个改动文件或跑一条检查都算。
- 多个执行官并行时各在自己的 worktree 里做，结束后集成；冲突停下交给人。
- 一轮只组一次队：规划师在同一轮再提交方案不会生效；房间会明说没生效，并让它改走退回重做或交给人，不静默丢弃。非 git 的复制工作区用阶段起点的文件清单做三方合并，删除也会传播；两边改了同一路径或改成不同内容就停成冲突。
- 验收员按只读角色处理：回合结束后工作区守卫会把它在任一副本（包括自己的复核副本）留下的改动退回，再按退回后的副本重跑证明和反例；原生写工具无法按角色收窄，所以边界落在“写了也留不下、判定仍按原样复核”，不是提示词。没有第二厂商时明确标「模型自查」。
- 工具面按角色切到单个工具：规划师的 `lodge_gate` 没有 `submit_verdict`，验收员只留 `submit_verdict`，派活、拍板、退回、停下只归规划师；执行官和聊天成员完全没有 `lodge_gate`。这是基座 `toolScope` 的逐工具选择器，不是提示词约定。
- 判定工具收到的完整入参不靠活动预览：基座的活动记录为界面裁剪（长方案会变成 `[additional data omitted]`），所以成功回执只带一个 `submissionId`，完整入参落在 `/tmp/lodge-gate-spool`（基座沙箱里 home 只读，临时目录两边都能写），房间取回后再走同一套校验；取不到就退回预览，不把截断内容当方案。超过 24 小时的暂存由工具自己清掉。
- 规划师只拆解，执行官每步执行，验收员每步自验，人只事后否决。规划师写清每一步的 `deliverable`，把每条契约要求落到阶段和工作包（`clauseIds`），不写验收命令，也不决定验收方法；验收员按房间目标自己定怎么验。
- 交付能不能验收只回答一次：`rooms/studio/acceptance/acceptance.js` 把平台对交付本身能说的事实收成一份契约（证明的状态/缺哪条/改动前是否也绿/包外改动/改动文件），`acceptanceOf` 一处裁决（这些事实 + 这一阶段的判定）。复核用它决定要不要提前退回，签收用它做最后一道门；两处只负责把 blocker 翻成给人看的一句话，不各自再判断一遍。加一条验收规则只改这一份，不在调用方补 if。
- 四条判定硬约束：验收 PASS 必须写一条 diff 之外的风险（没有写「无」，这一项由判定契约本身校验，不另立签收门）；PASS 必须带 `coverage`，逐条写清本步交付物（最后一步还包括 `plan.done`）的要求原文和实际核对的证据，缺一条就退回重问，第二次仍缺则本轮回合不通过；PASS 之前必须亲手验过——本回合至少读一个改动文件或跑一条检查，只有判定的 PASS 不算；PASS 必须在 `submit_verdict.protectedFiles` 里逐条确认受保护文件（依赖清单、锁文件、CI/配置，以及被改动的既有测试；新增测试不算，没有 diff 时按测试文件保守处理）。前三层由判定工具入口和复核协调器共同拦，不靠提示词自觉。
- 判定工具拒收的调用不算提交：回执带 `isError`（`ok:false`）时，这一票按「没收到」处理，平台不拿它的入参顶替；重交的提示里带工具的原话，连续两次都拒就收口成「判定被工具拒了，没有形成结论」。不这么做，模型会落回文字判定——文字带不了覆盖表，再被覆盖规则判成「没有逐条覆盖」，房间给出的原因就和实际发生的事不一样了。
- 交付阶段默认盲评，而且是上下文边界：复核信、催问和提醒只投递到验收员自己的线程（`privateRoom`），群聊里只有一条 @ 投影；验收员不拿执行官的过程话。决策阶段才放开对话。
- 验收员先核证据、再读代码，只按本步目标和验收标准判；目标外的重构、美化或新功能不作为退回理由。这是提示词纪律，不是硬门禁。
- 验收探针（`evals/verifier-probe`）用预埋缺陷加一个合格对照，量抓出、误放和误拒，并按验收模型写进 `~/.lodge/verifier-pool.json`；调用真实模型，不进 `check:done`。同一模型至少 10 个缺陷样本、5 个对照样本，误放率超过 5% 记为 excluded，规划师再选它当验收员会被平台拒绝；未实测或样本不足的模型不拦开工，但会在房间里标出来。
- 过程是时间线的一部分：`activity` 按消息顺序分组，连续调用收成一行；工具名不上主界面，动作由 `toolLabelOf` 说成中文；费用、重做和记忆只在最新一组的展开里，不另开过程面板。
- 验收通过后阶段自动收口；最后一步与「验收与结论」合并，不需要人确认。人看结果不满意时，开下一轮重做；已经交付的那一轮不改写。

## 决策卡

- 只有规划师能发起：目标里出现只能由用户拍板、且会改变结果的分叉时，调用 `lodge_gate_ask_decision` 提交一张卡（问题、2–3 条路、每条路的结果、推荐）；这一回合不写计划、不派活。
- 契约在 `shared/decision.js`：选项 id 小写且唯一，每条必须有 `effect`，推荐必须在选项内；状态只有 `open / answered / cancelled`。卡片是轮次字段 `pendingDecision`，同一轮只开一张，新的 ask 在已开卡时被忽略。
- 房间等待时，`studioNeedsYou` 投影成 `decision`，灵动岛和侧栏显示同一个问题；卡片从状态渲染，不做聊天文本解析。用户选完走 `decision` 动作：记答案、落一条「选：…」的用户消息、把问题与所选效果私下送回规划师，规划师按这个方向继续；「先不做」只关卡，不唤醒规划师。
- 等卡期间基座群聊里只留规划师：其他成员暂时移出基座群，@ 也收不到；作答只叫醒规划师，等它排完、第一次给执行官派活时再把全员放回。这里不用基座的“挂起”，因为挂起会被一次 @ 直接唤醒；成员名单仍由房间状态维护，界面始终显示三位角色。
- 单纯缺事实不走决策卡：规划师调用 `lodge_gate_ask_question` 只问一个核心问题，轮次进入 `openQuestion` 暂停；用户在下方的输入框回答后清空并继续。决策卡和提问是两种不同的暂停，不互相冒充。
- 系统不自作主张选项、不替人选、不兜底改判；模型负责理解分叉和写选项，业务负责一张卡、一次选择、一次续跑。

## 聊天室

- 共享房间 + 隐藏主持；成员没有独立 worktree，也没有阶段、证据和验收裁决。聊天室只读文件和只读公网，不执行交付。只读浏览器由 `grantBrowserToAll` 在建房时挂到 `body.spec.mcp`；成员卡只把它标成不可编辑的“只读浏览器（系统）”，不混进可编辑的 MCP 列表。
- 输入只认结构化 `mentions`：不带 `@` 交给主持；主持自己判断回答还是开轮，只有用户明确要求再讨论时才开，明确拒绝时主持不开。点名具体成员时直接交给那个人，并在用户消息上标 `direct`；轮次运行中直接点名会被拒绝，等这一轮结束或先叫停。`@所有人` 是开一轮受配额限制的讨论，正在讨论时明确说等这一轮结束。手打 `@名字` 不算点名。
- Lodge 对话开房时，主持同时给出 `goal`；建房用这个目标，不用最后一句动作短语。例如“找人一起评”会落成“一起评价短篇《开锁》哪里好、哪里要改”。目标缺失时才回落到用户原话。
- 从这里开出去的房写 `sourceRoomId` / `sourceName`；Lodge 主持回合会读取最近三个未归档子房的状态和最后一轮结论。开房消息里的 `openRoomId` 是同一个当前真相，两个来源按房间创建顺序去重后取最近三间。子房已经出结论时，主持直接接着结论说，不再让用户等或把内容贴过来。
- 聊天室只有两种模式：`open` 和 `round`，由 `chat.phase` 派生 `chatModeOf`，不另存一份 mode。轮次运行中的直接点名被拒绝，轮次结束自然回到开放。
- 班底是 `shared/chat-defaults.js` 里的固定六人（名字、性格、说话习惯、固定问题），建房时全量开通；第一轮由主持从六人里请 2–6 位并给每人一句今晚的焦点（`rooms/chat/cast.js`），阵容写进 `chat.castIds` / `chat.castFocus`，之后固定。开场卡由平台从班底和焦点渲染，不额外让主持说话。
- 发言顺序由 `rooms/chat/scheduler.js` 逐位选择：一轮默认 **今晚人数 + 2** 次发言——先每人一次，多出的两次按 `proposer → critic → synthesizer` 互补补问，同一人最多两次；房间存了更低的上限就按更低的来。“先别说”在轮中即时生效。主持先给结论，必要时用不超过 3 个短点（总长不超过 100 字）；用户明确要分点/分条/清单/列表/待办/表格时才用六段结构，六段仍映射到 `consensus`、`disagreements`、`unknowns`、`constraints`、`todos`。
- 聊天室开轮前检查房间预算；用量到顶时拒绝继续并提示等决定，不在长聊里无声烧钱。用户消息的认领在 `rooms/chat/service.js` 的 `handleMessage`：叫所有人、点名、交给主持和等待文案都归聊天室；`actions/room/round.js` 只按房型 id 分派，不认识聊天策略。
- 发言提示和总结提示在 `rooms/chat/prompts.js`，调度器只编排和落状态；初始 `chat` 状态由 `room-types/chat.js` 的 `initialChatState` 一处生成，Lodge 复用。界面读 `chatStatusOf` / `chatStartedOf`，不直接拼 `room.chat`。
- 成员之间不靠 `@` 接力；两种房间建房都写 `followMentions: false`。隐藏的让位/举手信号已经删除，成员回复里的 `@` 不唤醒人。
- 续跑靠 `chat.pending`、`chat.round` 工作项和本轮已发消息恢复计数；结论后房间不关，继续讨论走新的轮次。
- 可回看：`npm run replay:chat -- --room <id> [--round <n>]` 只读重放一轮的叫名、发言、总结和结论；结论是自动摘要时明确标出，没有发言或结论只报缺口。
- 上下文分三层：上一轮结论由 `chatBriefOf` 从 `chat_conclusion` 的 handoffBrief 取成共享简报，每位发言人都会拿到；`speakerPrompt` 再带上一位的原话和立场，让“接话”有对象；成员自己只带一句 `voice`（说话习惯，最多 30 字，只进 soul，不改工具面、不生成技能）。不给每个人各背一份履历。界面在发言行用两字标签显示固定立场（提议 / 质疑 / 收束），标签只读 `member.stance`，不参与判定。
- 隔离由 `server/crew/negative-list.test.js` 固定：聊天模块不读阶段、证据或 verdict，工作室模块不读 `room.chat`。

## 中期事件

运行中的事件不静默丢弃，按房型选择排队、并进当前 Run 或打断：

| 场景 | 处理 |
| --- | --- |
| 聊天室：不带 `@` | 交给主持；主持判断回答还是开轮，只有用户明确要求再讨论才开，明确拒绝时不开 |
| 聊天室：点名成员 | 只叫今晚班底里、没被静音的人；直接交给被点名的人，不占当前轮次，用户消息标 `direct`；其他人交给主持 |
| 聊天室：`@所有人` | 开一轮受配额限制的讨论；正在讨论时明确说等这一轮结束 |
| 聊天室：成员回复 `@` | 不唤醒下一棒；顺序由房间调度 |
| 工作室：阶段执行中的用户消息 | 直接交给规划师；工作室群 `followMentions` 关着，@ 不会唤醒，系统用 `sendToMember` 投递 |
| 工作室：审批卡 | 暂停房间，等确认；超时走持久 `work_item` |
| 工作室：晚到/旧回合 | 只认当前步骤和证据，旧回合丢弃并留事件 |
| 工作室：用户叫停 | 取消当前回合和未终态交接，房间保持可继续 |
| 定时器 / 阶段截止 | 写 `work_item`，到点由每房 worker 处理 |

规则：同一间房同一时刻只跑一个 worker；房间之间并发；事件要么排队，要么明确打断，不能既不改状态又不说明。
- 外部动作识别（推送、安装、删除、对外发送、提权、联网）是**准入**规则：按命令语义决定要不要停下来问人，不是安全边界；脚本可以绕开关键词。真正的边界是运行时权限、只读副本和审批桥，别把这段识别说成“外部动作都会被拦住”。

## 角色技能与房间投影

- `shared/role-toolbox.js` 是三角色常驻技能的唯一清单。技能文件在 `skills/role-packs/`，由 `server/skill-packs.js` 在组合根通过基座技能库导入并审核；不改基座源码。

| 房型 / 角色 | 技能 | 形态 |
|---|---|---|
| 规划师 | `lodge-plan`、`lodge-design` | 2 个基座技能 |
| 执行官 | `lodge-build`、`lodge-diagnose`、`lodge-ui` | 3 个基座技能 |
| 验收员 | `lodge-review`、`lodge-ui`、`lodge-security` | 3 个基座技能 |
| 聊天室成员 | 不挂工程技能；只读文件、只读公网、`chat-voice`、`chat-stances` | 提示模块 |
| Lodge 主机器人 | `listen / auto-grill / route / close`（`LODGE_HOST_RULES`） | 内置提示，不占基座技能 |
| 房间层 | 各房型的 `issues.js` / `retro.js` | 只读投影，经 presentation 钩子 |

- 共 7 个唯一基座技能、8 个角色挂载；`lodge-ui` 由执行官和验收员共用。合并前的 18 个技能已停用，名字留在 `RETIRED_SKILLS` 里，旧成员换身体或自定义时会被清掉，不再挂载。
- 聊天室没有 `grill-me`，也没有工程技能；主机器人自己判断何时追问，聊天成员只保留表达、席位和只读上下文。
- 成员技能仍走 `member.skills → body.spec.skills → engine.setBotSkills`。`body.js` 和 `body-swap.js` 合并角色技能：内置在前，自定义追加，最多 8 个；旧房间换身体时补上角色包。成员详情里的技能列表和 MCP 列表是只读展示：技能从角色包读，MCP 从成员授权读，不在成员卡里改。
- 技能的“调用”：Lodge 只负责挂载（`engine.setBotSkills` → 基座 `PUT /api/bots/:id/skills-library`，名单存为 bot 的 `assignedSkills`）；基座每轮只把**清单**（名字 + 一句话）交给引擎，正文按需读，永远不整段拼进 system prompt。技能库里的其他技能进不来。Lodge 不执行技能内容，`SKILL.md` 是方法说明，不是权限。
- 挂载有三道保证：启动时 `ensureRoleSkillPacks` 把包导入并审核（正文变了的旧包先删再导入，不保留旧副本），失败记 `ready=false`，不静默；建房前 `create.js` 检查 ready 和 `features.skillsLibrary`，不过就在造工作区前拒绝；`body.js` 挂技能失败会删掉刚建的 bot，建房失败。单成员最多 8 个技能；每回合的固定提示词有预算门禁（`npm run check:prompts`）。
- 模型是否真读某个 `SKILL.md` 由模型判断，机制上不强制；能强制的是验收门禁和角色规则。核对看启动日志 `role skill packs: 7 ready`，或 `GET /api/bots/<id>/skills-library` 的名单。
- 规划师只有两个技能：`lodge-plan` 管论证、问清、拆阶段、工作包和组队（执行官按包定数，验收员默认一位）；`lodge-design` 管术语、边界和契约。`grill-with-docs`、`to-spec`、`to-tickets` 不装原版，避免多出 GLOSSARY/ADR、spec 文件或外部 ticket 三个真相源。
- 聊天成员是 `participant`，不继承工程技能；只有只读文件、只读公网、`chat-voice` 和 `chat-stances`。外部动作仍由审批桥拦住。聊天室必须使用支持逐次确认的引擎；不会问人的模型在建房前就被拒绝，不能把只读写在提示词里假装实现。
- 验收员用 `lodge-review`：自己定怎么验、自己跑检查，只看本阶段目标和交付物；must-fix 必须挂一条会失败的 check，只有 minor 就判通过；不引入 subagent，不把多个验收员的意见合并成分数。
- 各房型的 `issues.js` / `retro.js` 是只读投影，不是技能：在每次组装房间视图（`presentRoom`）时通过 presentation 钩子计算，模型看不到，也不花 token。工作室把阶段投成 issue，聊天把结论/待办投成 issue；复盘只引用真实返工、超时或用满轮次。它们不写房间状态，也不新增角色。

## 工作室组队

- 建房只问目标（和可选文件夹）；工作室先只开规划师一个 bot，阶段只有「目标对齐」。成员、模型和怎么拆都由规划师决定，用户不排组织架构。
- 规划师用 `lodge_gate_submit_plan` 提交方案与队伍：契约（可观察结果、边界、非目标、假设）、阶段（标题、交付物、是否保持行为不变）、工作包（标题/文件/负责的 clauseIds）、执行官与一到三位验收员（默认一位，含 engine/model）。验收命令和验收方法都不由规划师写。平台先做契约门禁：至少一条边界、至少一条非目标、每条结果都有可观察标准、每个阶段至少一个工作包且每个包写清文件和负责的 clauseIds、契约条款全部落到阶段和工作包；再做角色、模型、厂商、合并和包独立性校验，最后用内部成员开通流程建 bot/worktree/群成员。校验不过把具体错误回给规划师改一版，第二次失败交给人。
- 高风险阶段默认两位验收员：同一阶段有并行工作包，或工作包改到依赖清单、锁文件、CI/配置、`.env` 时，机器上有两家厂商就要求两位来自不同厂商的验收员，全部通过才收口。只有一家厂商时不拦开工，但房间会明确写「模型自查，不算独立复核」。实测误放率过高的验收模型会被验收员池拒绝。
- 工作包决定人数：同一阶段里文件互不重叠、且都写了文件的包才能并行，几位执行官就接几个包，一一对应；没有文件或文件重叠按一位执行官串行。
- 规划师的停止和决策卡是建议：`stop_round` 只写理由，系统在没有进行中的执行和复核时才真正停，不打断正在跑的回合；决策卡由人选择，暂停/恢复和能不能现在出卡归系统。重做次数、预算和超时也不因建议而放宽。
- 建房 API 不接收 `orchestration`，计划阶段也不接收 `assignees`：编排由系统按工作包独立程度决定，派活由系统按工作包和人数分配；带了直接拒绝，不静默忽略。
- 用户不能加/减工作室成员；成员登录失效或额度用完可以换 engine/model 修故障，不能改提示词、技能或 MCP。规划师也能用 `lodge_gate_adjust_member_model` 换模型。
- 聊天室也不让人选成员：建房只问话题，固定六人班底一次开通，主持人按话题请 2–6 位；用户只能静音和换模型，不加、不删、不改人设。

## 附件与视觉证据

- 附件不落房间存储：上传是 `POST /api/attachments` 的薄代理，文件进基座附件库；消息只带 `meta.attachments` 和 `<attached-image>` / `<attached-file>` 标记。
- 图片由 harness 转成原生输入；文本文件带正文，其它文件留路径；数量、大小和路径形状在消息动作里校验。
- HTML 交付在复核前由平台渲染成图：`screenshot.js` 调本机无头 Chrome，`visual-audit.js` 做像素检查，`previews.js` 记到房间。底座浏览器挡本地文件，这一层暂时由平台驱动 Chrome，是明确例外。
- 验收判定可带 `visual: { seen, colors, contrast }`；平台在交付卡上区分「没核对」「没看到」「看到」。成员 `body.capabilities` 记录声明的图片和工具能力，声明不是验证。
- 验收员选身体时先选声明能看图的实例，其中再优先不同厂商；没有能看图的才退回跨厂商复核。

## 边界靠测试固定

完整映射见 [agent-design.md 的「约束落在哪一层」](agent-design.md#约束落在哪一层)；这里只列结构和门禁。

- 分层与依赖方向：`layer-boundaries.test.js`、`negative-list.test.js`、`boundary.test.js`。
- 房型契约与 UI 边界：`rooms/kinds.test.js`、`architecture.test.js`。
- 死代码与依赖图：`npm run check:unused`、`npm run check:deps`；规则在 `knip.jsonc`、`.dependency-cruiser.cjs`。
- 真实评测：`evals/rooms/`；固定题、外部脚本核对，不追求单次最好成绩。

## 监督边界

- 没有独立的监督会话来盯循环和跑偏；不引入第二个主循环，也不让监督改写业务结论。
- 停滞由三层确定性的兜底处理：进度守卫（只在主路径上暂停房间）、阶段截止（15 分钟，落 `work_item`）、assignment 租约（8 分钟，只有这一位一直没有活动才停它）。三者重启后仍然到点。
- 跑偏与收尾的最终裁决是人：验收卡、审批卡、停止/接回工具都在人手里。
- 为什么不做独立监督：每一轮被阶段切开，每步都有可机器验证的验收和人的介入点；独立监督要再加一个会话、一份上下文和一条成本线，当前收益不抵。以后出现跨多阶段、长时间无人的运行，再按“监督只决定继续/停止”的边界加独立观察者，而不是在主循环里加一个 if。

## 电脑操作

电脑不是一项能力，也不是一项权限，而是一种**工作区**：工作室在哪里干活。建房时默认给一个文件夹；要碰这台电脑，勾选“在这台电脑上干活”——选这一下就是同意。聊天室没有工作区，所以永远不碰用户的电脑。

- **选“这台电脑”就是同意。** 旁边只有一句话：它会看见并操作你的屏幕，随时可以停。没有单独的授权卡、没有租约、没有逐条确认；剩下的全是工作室已有的东西：计划、阶段、执行、证据、验收、停。
- **工作区提供手，不提供新的产品概念。** 和 worktree、普通文件夹一样，工作区是一个实现：它决定交付物放哪里、能对什么动手。加手机、远程桌面，是加一个工作区实现，不是加一个功能。
- **计划和证据照旧。** 规划师在方案里写清要做什么；每个动作、截图、回执进房间时间线；验收看结果（文件、回执、页面状态），不看过程；完成 = 验收通过。
- **登录、支付、验证码交给人。** 在房间里问一句，人接手做完再继续；agent 不代填凭据。
- **停沿用现有的中断。** 人动鼠标键盘，agent 让开；停是暂停这一轮，不是给能力设上限。
- **不做的**：权限轴、租约卡、首次授权卡、接管面板、每步确认、统一工具表、默认虚拟机、默认监看模型。这些都在替 agent 决定能做多少，agent 越强越碍事。
- **随 agent 变强**：计划更准、执行更顺，工作区不变；平台一行不用改，改的只是房间默认。
- **只剩三样不能删**：在哪里干活（建房时一次）、证据（房间的既有事实）、停（随时）。其余全部由 agent 自己决定。
- **落点**：工作区实现（和 worktree/plain 同一个接口）声明“能对桌面动手”；提供方跑在沙箱外，经宿主 MCP、专用回环端口和每回合令牌接进来，工具事件和截图走附件/活动管线；建房的“在哪里干活”多一个选项；聊天室没有工作区。界面只多这一个选项和一句话。
- **现状**：房型、工作区、授权和沙箱端口已经接好；真正操作电脑的提供方仍是外部 MCP 服务器（必须配置 `LODGE_DESKTOP_MCP_URL`，本机回环地址、带端口，约定 8897），没配或不是回环就拒绝建房。验收：聊天室没有这双手；选了“这台电脑”不在干活中途再问；证据可复核；停立即生效；换一种工作区不改房间引擎。
- **基座只约束副作用**：一回合的预算（工具调用数、墙上时间）是资源保险丝，不是能力上限；等人回答审批卡可以等满这一回合，不会到 15 分钟就把卡丢掉；工具不藏、只按授权拦。

## 已知边界

- 单用户、本地仓库、本地 CLI；不是云端或多人组织。
- 不是通用文件系统沙箱；没做的隔离不说做了。
- 截图由平台驱动 Chrome，是当前例外；之后可收成工具。
- 验收员声明能看图，不等于运行时真的看见；`seen` 才是事实。

## 许可

产品 MIT；基座是本仓库的 Rust 实现，沙箱规则改写自 OpenMausBot OSS 的 bot-box（Apache-2.0，归属与许可证随包）；Pi 为 MIT。第三方 notices 随包。
