# Lodge · 架构

> 本文回答：服务端怎么分层、数据真相在哪、交接和门禁怎么走、边界靠什么固定。
> 通用判断与**原则总表**见 [思想.md](../思想.md#原则总表)，界面规则见 [design.md](design.md)，运行与运维见 [operations.md](operations.md)。

## 形态

- 服务端 Node 24，ESM，无框架；UI React 19，`createElement`，Vite；桌面 Electron 壳，macOS 发 ad-hoc 签名 zip。
- 基座是独立的 `crew-chat-base`，固定 OpenMausBot OSS 版本，HTTP 接入，默认 8799。基座不在本仓库改。
- 数据在 SQLite 单文件 + 房间目录的 transcript 与证据里。

## 设计理念

下面是 Lodge 的实现判断；通用原则见 [思想.md](../思想.md)。

- **房间长期存在，轮次才是工作单位。** 完成只结束这一轮；房间回到空闲，工作区和成员留下。
- **规则和管道分开。** `kernel/` 只写状态和转换；`store/` 只写事务和仓库；`actions/` 只写 HTTP 动作；`rooms/*` 只写房型执行。规则不依赖 SQL、端口或具体引擎。
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
- 模式差异的依赖方向是 `service → 注册表 → kind`、`kind → shared/ports`；反向 import、UI import 服务端、聊天室和工作室互 import 都由测试拦住。基座群聊线程只经 `ports/threads` 暴露，房型不直接 import `rooms/base` 的适配器。
- 新增模式 = 描述符 + kind + 视图 + 自己的动作入口；不改 `Room`、另一间房或共享房间协议。运行期不切换房型；底层角色仍是规划师/执行官/验收员三类。

**为什么这么分**

- **策略模式**：房型是运行策略，不是第二套房间模型；调度/圆桌/专项/接力共用同一份房间、成员和 Assignment 协议。
- **接口隔离**：创建运行、只读投影和生命周期分开，调用方只拿需要的那组，避免房型接口膨胀。
- **开闭与替换**：注册表和契约测试保证新模式可替换；关键生命周期已走钩子，剩余模式路由集中在用例入口，不再扩散到房间本体。
- **不可拆分标尺**：一个模式的创建记录、等待信号和只读投影能独立测试、独立变化，所以各自成模块；`kind.js` 只负责把它们装配成同一份策略。房间身份、消息和交接必须一起保持一致，所以留在房间本体。

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
- 房间主时间线只有三个角色的消息和结果卡；系统交接、阶段回执和完成记录留在后台账本，不作为成员发言展示。规划师每轮用两三句自然中文说计划（下一步和交给谁 / 怎么算过 / 做完是什么样），不套模板标签；正常派活由系统私下投递，不再叫规划师重复一句话。
- 注意力只列真正等人动手的事：审批、提问、阻塞、冲突、退回、超时和规划师交给人处理。`review`（验收员在看）和验收通过后的 `signoff` 只是进度，带 `actionable: false`，不进入待处理队列、不弹通知、不把灵动岛变成“等你决定”。验收通过不再需要人确认。
- 轮次终态不回退；退回是重新打开阶段或新建交接，不改终态记录。
- 工作室的验收通过/退回、交接的下一棒由 `relay.js` 决定；聊天的阶段转换由 `rooms/chat/state.js` 的表决定。
- 读模型只在 `shared/room-status.js` 和各房型自己的状态模块；界面不拼状态。岛的状态映射见 [design.md 的「灵动岛」](design.md#灵动岛)。
- 共享状态不是一个大对象：`shared/states.js` 定义值，`shared/room-status.js` 用一组纯函数回答“房间在哪、轮次在哪、现在是否已交付、这一步/聊天在干什么”。消费者按问题取，不拿一份包含所有字段的快照；`presentRoom` 只组合投影，不复制状态。
- 这样做的代价是消费者可能组合错（比如把历史交付当成当前交付）；用状态目录、单一读模型和测试约束，而不是靠一个万能对象兜住。
- 加成员只影响之后的派发和复核；当前阶段的 assignees 和在跑的复核轮次固定，规划师唯一且不能移除。

## 轮次生命周期

- 状态：`planning | active | completed | rejected | failed | superseded | stopped`。终态不再回退。
- 同一房间最多一个 open round（数据库部分唯一索引）；`room.activeRoundId` 为空或指向 open round。
- 开始、完成、停止、退回、失败、作废都走同一条事务：更新轮次、清 `activeRoundId`、设 `lastRoundId`、房间回 `idle`，再写事件。
- 完成要求所有阶段 passed 且没有未终态交接；失败只结束这一轮，不把房间变成终态。
- 房间暂停不改变轮次状态；恢复继续同一轮。归档先停止 open round，再设 `archivedAt`；恢复回到 idle，不重新打开终态轮。
- 运行时按 room+round 生命周期创建和释放；停止、完成、归档、删除都会清掉 stage timeout、自动重做和待确认卡。`rooms/studio/turns.js` 只做装配，结果收集、规划师决定、回合采集和重启续跑分别在 `rooms/studio/runtime/` 的四个模块里。
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

- 规划师派发给执行官；证据就绪后系统请求验收员复核。默认接力由 `server/crew/rooms/studio/relay.js` 决定：验收退回直接交回执行官；通过时中间步骤自动收口并派发下一步，最后一步交回规划师收尾；只有重做预算用完、合并冲突或没有可执行官时才回到规划师/人。
- 验收通过即完成：中间步骤自动推进，最后一步由界面自动确认（`rooms/studio/auto-accept.js`，400ms 后走 `accept`），不需要人再点确认；`accept` 仍会重跑 `gateFor`（结果证据、证明、全部验收员 PASS）。PASS 必须带覆盖、重跑的证明、反例和 diff 外的风险；工具没挂上时这些字段从文本 json 读，平台照常执行和核对，缺一项就不通过。房间字段 `autoDeliver` 只影响没有界面自动确认的调用方（例如承诺任务）。门禁不满足就交给人处理。
- 工作室成员的立场是角色定义上的稳定字段（`ROLE_DEFINITIONS.stance`），提示词展开、界面可读，不靠每轮临时编一句；成员的项目经历不另存，交接包里从房间已有的证据和判定回看“你在这个房间的经历”，事实仍只有房间一份。
- 工作室只有一个共享房间：派发、复核、退回、通过都由系统在群聊发一条带 @ 的投影；投递不依赖模型点名。两种房间建房时都在基座写 `followMentions: false`，成员回复里的 @ 不再唤醒下一棒；聊天室先保证今晚请到的人各说一次（每轮最多 4 位），再按立场互补。提示词投递走成员自己的执行线程：并行派发一直是，盲评复核现在也是；群聊只留一条可读的 @ 投影，验收员不会被执行对话污染上下文。
- 用户停下回复走 `interrupt`：取消当前回合和未终态交接，房间保持 `active`；不写 `pauseReason`，也不要求再点继续。
- 平台在每步交回时收集结果证据：候选人提交、diff、改动文件和执行官的结果说明；验收员在自己的只读副本里自己找证据、读文件、跑检查。没有结果证据就不进入复核。
- 执行官只写自己的工作包：平台按派发顺序把人对应到包（一个执行官时拿走该步全部包）。工作包同时是写边界和证明边界的唯一依据：规划师提交的方案里每个阶段至少一个包，每个包必须写清要改的文件和它负责的 `clauseIds`；阶段里的每条契约要求都要落到一个包，否则方案被退回。回合结束后在 git 工作副本里把包外的改动退回去，并在时间线留一句；越界事实写进结果证据的 `meta.outOfBounds`，验收员能看到。证明文件（`lodge-proof.json` 和 `lodge-proof/`）不属于任何包，但每个包都能写自己的那份。复制目录和原地目录在阶段起点记文件清单，交付时做差检测包外改动；它们没有可回退的版本，所以包外改动会直接挡住确认，等人处理。
- 验收员的证据只能来自自己的复核副本：PASS 的工具调用如果指向别人工作树或集成目录，判定会被退回重问。读边界现在更早生效：群里每出现一次工具调用，房型守卫就核对一次路径，读到别人的工作副本会立刻叫停这位成员的回合（`engine.interruptBot`）并把这一轮标成 `blocked.reason = read-boundary`；回合结束时还会再对账一次。macOS 上应用启动的基座默认带 `OMB_BOT_BOX=1` 和 `OMB_BOT_BOX_DENY_SIBLINGS=1`（`electron/launch.mjs:baseBoxEnv`，用户显式设 `OMB_BOT_BOX=0` 时尊重用户）：数据目录不可读、自己的副本可写，工作目录的兄弟目录（同房间其他成员的副本、集成目录）由 profile 显式 deny；源仓库在房间目录之外，仍可读，由平台读边界兜。想连 HOME 也只读，再加 `OMB_BOT_BOX_HOME_READONLY=1`。设计见 [plans/sandbox.md](plans/sandbox.md)。
- 交付自带证明：单包阶段写根目录 `lodge-proof.json`，并行阶段每个工作包写 `lodge-proof/<n>.json`（`{ entry, steps[{ clause, run, expect }] }`，只写怎么重跑，不写结论）。平台用 `rooms/studio/proof-runner.js` 在一次性副本里逐份执行 entry 和每条 step，超时 120 秒，环境去掉密钥变量，输出脱敏；每条包负责的 clause 至少有一条 step 在交付上跑绿，缺一条就是 `incomplete`，step 跑红就是 `failed`。结果随结果证据入库为 `meta.proof`（`status`、`entries`、`steps`、`missingClauses`、`weak`、`behavior`），交付卡只显示入口和「已证明 / 未证明」。所有交付都要有 verified 且覆盖全部 clause 的证明才能确认，没有例外。
- 证明要绑定这次改动：平台把同一份证明在阶段起点（`stageBases[stage]`）的副本上再跑一次。阶段默认 `behavior: change`，证明在改动前也必须失败；前后都绿的证明标记 `weak`，不能确认。重构或保持行为不变的步骤由规划师标 `behavior: preserve`，这时前后都绿才是对的。
- 验收员只负责重跑和补刀：PASS 必须逐条重跑交付的全部证明（并行阶段是每一份 package 证明，按工具调用记录核对，不信自述）；每一个 PASS 都要提交至少一条反例命令（工具可用时在 `submit_verdict.falsify`，工具没挂上时在文本 json 的 `falsify`），由平台在复核副本和阶段起点各执行一次。改变行为的步骤，两边都绿的命令没有区分力，会被退回；交付上跑红是反例。保持行为的步骤（`behavior: preserve`）反过来：两边都绿是对的，交付上跑红是反例，改动前就红说明旧行为已经变了，同样是反例。缺反例、缺风险、缺覆盖都按不通过收口，不因为走文本就放行。
- 复核提示不只看 diff 尾巴：改动从开头给到 32k 字符，文件清单最多 200 个；超出的部分明确标出来，让验收员在副本里按文件读全文。判定必须有亲手验过的工具痕迹，读一个改动文件或跑一条检查都算。
- 多个执行官并行时各在自己的 worktree 里做，结束后集成；冲突停下交给人。非 git 的复制工作区用阶段起点的文件清单做三方合并，删除也会传播；两边改了同一路径或改成不同内容就停成冲突。
- 验收员按只读角色处理：回合结束后工作区守卫会把它在任一副本（包括自己的复核副本）留下的改动退回，再按退回后的副本重跑证明和反例；原生写工具无法按角色收窄，所以边界落在“写了也留不下、判定仍按原样复核”，不是提示词。没有第二厂商时明确标「模型自查」。
- 工具面按角色切到单个工具：规划师的 `lodge_gate` 没有 `submit_verdict`，验收员只留 `submit_verdict`，派活、拍板、退回、停下只归规划师；执行官和聊天成员完全没有 `lodge_gate`。这是基座 `toolScope` 的逐工具选择器，不是提示词约定。
- 规划师只拆解，执行官每步执行，验收员每步自验，人只事后否决。规划师写清每一步的 `deliverable`，把每条契约要求落到阶段和工作包（`clauseIds`），不写验收命令，也不决定验收方法；验收员按房间目标自己定怎么验。
- 四条判定硬约束：验收 PASS 必须写一条 diff 之外的风险（没有写「无」）；PASS 必须带 `coverage`，逐条写清本步交付物（最后一步还包括 `plan.done`）的要求原文和实际核对的证据，缺一条就退回重问，第二次仍缺则本轮回合不通过；PASS 之前必须亲手验过——本回合至少读一个改动文件或跑一条检查，只有判定的 PASS 不算；PASS 必须在 `submit_verdict.protectedFiles` 里逐条确认受保护文件（依赖清单、锁文件、CI/配置，以及被改动的既有测试；新增测试不算，没有 diff 时按测试文件保守处理）。前三层由判定工具入口和复核协调器共同拦，不靠提示词自觉。
- 交付阶段默认盲评，而且是上下文边界：复核信、催问和提醒只投递到验收员自己的线程（`privateRoom`），群聊里只有一条 @ 投影；验收员不拿执行官的过程话。决策阶段才放开对话。
- 验收员先核证据、再读代码，只按本步目标和验收标准判；目标外的重构、美化或新功能不作为退回理由。这是提示词纪律，不是硬门禁。
- 影子评审只给安全、权限、依赖、隐私和数据风险的对照意见，不重复验收员的逐行功能评审，不参与判定。
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
- 发言顺序由 `rooms/chat/scheduler.js` 逐位选择：每轮最多 4 位、每人一次；先给本轮没说过的人，再按 `proposer → critic → synthesizer` 互补，最后才随机。`chatTurnLimitOf` 默认 4、最多 4，实际取 `min(上限, 今晚人数)`；“先别说”在轮中即时生效。主持默认只用两三句话收口（不超过 100 字），不写三段；用户明确要分点/分条/清单/列表/待办/表格时才用六段结构，六段仍映射到 `consensus`、`disagreements`、`unknowns`、`constraints`、`todos`。
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
- 技能的“调用”分三段：Lodge 只负责挂载（`engine.setBotSkills` → 基座 `PUT /api/bots/:id/skills-library`，名单存为 bot 的 `assignedSkills`）；基座每轮把技能索引写进系统提示（一行一条：名称、描述、`SKILL.md` 路径）；模型判断命中后用文件工具读全文。Lodge 不执行技能内容，`SKILL.md` 是方法说明，不是权限。
- 挂载有三道保证：启动时 `ensureRoleSkillPacks` 把包导入并审核，失败记 `ready=false`，不静默；建房前 `create.js` 检查 ready 和 `features.skillsLibrary`，不过就在造工作区前拒绝；`body.js` 挂技能失败会删掉刚建的 bot，建房失败。索引只对支持 workspace 文件的引擎注入（Claude Code、Codex 有；grok、openai-compat 没有），单成员最多 8 条，基座索引上限 30 条 / 4000 字节。
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
- 影子评审是独立 bot，但只对单回合给建议，不参与判定，也不决定继续或停止。
- 跑偏与收尾的最终裁决是人：验收卡、审批卡、停止/接回工具都在人手里。
- 为什么不做独立监督：每一轮被阶段切开，每步都有可机器验证的验收和人的介入点；独立监督要再加一个会话、一份上下文和一条成本线，当前收益不抵。以后出现跨多阶段、长时间无人的运行，再按“监督只决定继续/停止”的边界加独立观察者，而不是在主循环里加一个 if。

## 已知边界

- 单用户、本地仓库、本地 CLI；不是云端或多人组织。
- 不是通用文件系统沙箱；没做的隔离不说做了。
- 截图由平台驱动 Chrome，是当前例外；之后可收成工具。
- 验收员声明能看图，不等于运行时真的看见；`seen` 才是事实。

## 许可

产品 MIT；OpenMausBot OSS 的 runtime、drivers、Electron 壳为 Apache-2.0；Pi 为 MIT。第三方 notices 随包。
