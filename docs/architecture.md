# Lodge · 架构

> 本文回答：服务端怎么分层、数据真相在哪、交接和门禁怎么走、边界靠什么固定。
> 产品判断与**原则总表**见 [Lodge.md](../Lodge.md#原则总表)，界面规则见 [design.md](design.md)，运行与运维见 [operations.md](operations.md)。

## 形态

- 服务端 Node 24，ESM，无框架；UI React 19，`createElement`，Vite；桌面 Electron 壳，macOS 发 ad-hoc 签名 zip。
- 基座是独立的 `crew-chat-base`，固定 OpenMausBot OSS 版本，HTTP 接入，默认 8799。基座不在本仓库改。
- 数据在 SQLite 单文件 + 房间目录的 transcript 与证据里。

## 设计理念

- **房间长期存在，轮次才是工作单位。** 完成只结束这一轮；房间回到空闲，工作区和成员留下。
- **规则和管道分开。** `kernel/` 只写状态和转换；`store/` 只写事务和仓库；`actions/` 只写 HTTP 动作；`rooms/*` 只写房型执行。规则不依赖 SQL、端口或具体引擎。
- **一个持久队列。** 定时、审批、重试和启动回收都进 `work_item`；先落库再执行，租约、退避、去重和死信同表。
- **一层一个状态。** 房间说 `idle/active/paused/stopped/archived`；轮次说 `planning/active/completed/rejected/failed/superseded/stopped`；界面不再用一个 `complete` 同时表示两者。
- **事务边界就是业务边界。** 轮次开始、完成、停止、退回、失败、作废都在一个事务里改轮次、房间指针和事件；不允许“阶段全过但房间卡住”。
- **已验证的能力不重写。** gates、验收、workspace、engine 是执行能力，不是这次要换的管道；内核只负责把它们组织成可恢复的长期工作。
- **为长期任务赢，不靠模型或提示词。** 差异化在连续性、证据、恢复和人的介入点；模型只做理解与计划，完成、权限、证据和金额的判定留在代码。

## 分层

```text
Electron / Web
      │ HTTP + SSE
ui/src/store.js              ← 唯一的 UI 传输适配层
      │
views + room/<kind>/view.js  ← 房型视图策略
──────── HTTP / SSE 边界 ────────
server/index.js              ← 唯一组合根
service.js                   ← 路由分发与用例组合
应用层：rooms/*、kernel/live/*
领域层：room-types、gate、assignments、verifiers、orchestration、presentation
端口：crew-ports、runtime-port、workspace-ports、surface-port
适配器：store、engine、workspace、surfaces/base
```

依赖只向内：领域层不依赖应用层、端口或适配器；应用层只用注入的端口；适配器只在组合根装配；UI 不 import `server/crew`。

## 房型是策略

房间是唯一实体，运行模式是挂在房间上的策略，不是另一套房间模型。

| 单元 | 职责 | 变化原因 |
| --- | --- | --- |
| `Room` 记录 | 目标、成员、状态、阶段、Assignment、证据、交付；唯一实体 | 房间协议 |
| `room-types/*` | 名称、默认成员、能力矩阵、创建纯规则；不持有运行时 | 产品描述符 |
| `rooms/<mode>/kind.js` | 成员 soul、记录、启动、投影、等待信号；同一模式的行为不可拆 | 模式行为 |
| `rooms/kinds.js` | 唯一注册表；把策略裁成 `mode` / `presentation` / `lifecycle` 三组窄接口 | 组合与替换 |
| `service.js` | 路由与业务编排；模式差异优先走注册表钩子，具体模式用例在组合点装配 | 用例流程 |
| `ui/src/room/*` | 房间壳、房型视图、岛、共享展示；不 import `server/crew` | 呈现 |

**接口与依赖**

- 模式差异依赖 `roomModeForType`、`roomModeOfRoom`、`roomPresentationOfRoom`、`roomLifecycleOfRoom`；三组接口分别回答“怎么建/怎么跑”“只读投影什么”“哪些动作会改状态”。轮次启动、成员能力这类差异走策略钩子；`service.js` 作为组合点装配具体模式用例。
- 模式差异的依赖方向是 `service → 注册表 → kind`、`kind → shared/ports`；反向 import、UI import 服务端、聊天室和工作室互 import 都由测试拦住。
- 新增模式 = 描述符 + kind + 视图 + 自己的动作入口；不改 `Room`、另一间房或共享房间协议。运行期不切换房型；底层角色仍是规划师/执行官/验收员三类。

**为什么这么分**

- **策略模式**：房型是运行策略，不是第二套房间模型；调度/圆桌/专项/接力共用同一份房间、成员和 Assignment 协议。
- **接口隔离**：创建运行、只读投影和生命周期分开，调用方只拿需要的那组，避免房型接口膨胀。
- **开闭与替换**：注册表和契约测试保证新模式可替换；关键生命周期已走钩子，剩余模式路由集中在用例入口，不再扩散到房间本体。
- **不可拆分标尺**：一个模式的创建规则、运行行为、投影和等待信号必须同时变，所以收在同一个 `kind.js`；房间身份、消息和交接必须一起保持一致，所以留在房间本体。

## 数据与真相

- SQLite `room` 存长期工作室、成员、工作区和 `idle/active/paused/stopped`；`work_round` 存一轮的目标、计划、阶段、门、决策、费用、预算和交付；`project` 存轮次分组和北极星。
- `messages` 存时间线并带 `work_round_id`；`work_round_id=NULL` 是房间级消息，当前视图会带上它，旧轮详情只读该轮。证据和结论都是消息。
- `room_event` 存结构化轮次/运行时事件，带 `idempotency_key`；`assignment` 存房间内交接并带 `work_round_id`。旧轮和新轮在存储上就分开。
- `work_item` 是唯一的持久队列和唯一的时钟：定时、审批、阶段截止、重试和恢复都走它，带 `attempts/max_attempts/available_at/lease_until/dedupe_key/last_error`。`enqueueWork` 是唯一入口，同一个 id 再投一次表示重设到点时间；轮次结束时同事务作废属于该轮的待办，领取过期后按退避重试，耗尽即死信并通知人。
- 调度器不认识房型：到期项交给 `live.handleWork`，房型按 `kind` 处理自己的活（`approval`、`stage.deadline`、`chat.round`）。新增一种长期动作只需注册一个处理器，不改调度器和存储。阶段超时同时有内存计时器保证准时和持久截止项保证重启后仍会到点；房型换轮或阶段已结束，迟到项是安全的空操作。
- 聊天室也有持久时钟：一轮讨论进行时占一条 `chat.round` 工作项，`chat.turns` 落了已发言次数；进程重启后从下一次发言续跑，不把整轮从第一句重来。发送前先落 `chat.pending`（第几回合、谁、之前的消息 id）；重启时用它在基座历史里找已经到达的回复，找到就补账，找不到只记一次未回应，不重发。
- 交接租约也走同一条队列：assignment 进入 `sent` 时落 `assignment.lease`（8 分钟），每次捕获回合续租，`reported` 或失败时取消。一个成员到期只停这一位；还有别人在跑就继续等，最后一位停下才收口。阶段截止（15 分钟）保留为整步兜底。
- 存储拆成 `store/` 仓库：`work.js`、`rounds.js`、`timeline.js`、`assignments.js`、`projects.js`；`store.js` 只做打开、组合和房间视图。房间写入和轮次写入是两条显式路径：`updateRoom` 只写房间自己的字段，`updateRound` 才读写当前轮次；终态轮拒绝写入。HTTP 动作按动作族放在 `actions/room/{lodge,run,admin,round}.js`，`room-actions.js` 只做分派，`service.js` 只做组合根。
- `SCHEMA_VERSION=4`；旧库版本不匹配直接拒绝，运行 `npm run data:reset` 重建。旧数据不迁移，不留兼容字段。
- 房间目录 `transcript.jsonl` 先追加并 fsync，再写 SQLite；轮次级目标、结论和证据文件可重建。
- 当前用户是全局资料（`profile` 表一份），房间展示和 agent 上下文从它读，不再各存 `humanName`；改昵称后下一次快照即全局生效。
- 一轮完成只结束这一轮：工作室回到空闲；下一轮在同一工作室开，旧轮保留为可回看的轮次。
- 没有全局成员表，也没有全局 Assignment 表；成员和交接跟着房间走。证据与 verdict 正文留在消息里，Assignment 只存引用。
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
- 运行时按 room+round 生命周期创建和释放；停止、完成、归档、删除都会清掉 stage timeout、自动重做和待确认卡。`rooms/studio/turns.js` 只做装配，自动检查、规划师决定、回合采集和重启续跑分别在 `rooms/studio/runtime/` 的四个模块里。
- 状态读模型：`roomStatusOf` 只返回 `idle/active/paused/stopped/archived`；`roundStatusOf` 管轮次；`idleDelivered` 表示当前是否已交付；`stageStatusOf` 把阶段状态和阻塞、待回答、待拍板收成一个词；`chatStatusOf` 把聊天阶段、运行标志和首条发言收成一个词。界面只读这些函数，不自己拼状态。
- 状态目录：`shared/states.js` 是唯一清单，收拢房间、轮次、阶段、交接、聊天、work item、审批、复盘记忆、注意力和交接消息等状态与转移表；服务端和共享层的状态读写都从这里取常量，`shared/states.test.js` 还会扫源码，防止裸状态字符串回潮。
- 事件覆盖：轮次开始/终态、阶段派发/通过/重做/退回、交接的每次状态变化、聊天的每次阶段变化都写 `room_event`；`round.started` 带阶段快照。事件只做审计和重放，不回写业务状态。
- 只读重放：`npm run replay:round -- --room <id> [--round <id>]` 从事件重建阶段和交接状态，和当前数据库对比；只报告差异，不改状态。实现见 `server/crew/rounds/replay.js`。

## Assignment

发起人、接收人、阶段、原因、brief、状态、结果、证据引用、裁决引用、父交接、时间戳。

- 接收人是房间成员；同 id 对应同一次交接，重复创建返回原记录，不覆盖证据。
- 状态链：`created → sent → reported → passed`，另分 `failed / rejected`；只通过一个 transition 入口改，校验和写入同一事务；终态不回退。送达失败是重试，新建一条指向失败那条，不重开旧记录。
- 交接原因：`dispatch / rework / retry` 是工作交接；`review` 是执行官交给验收员复核；`summary` 是验收通过后交给规划师收尾；`decision` 是退回后交给规划师做例外决定。
- 人不是房间成员：交给人的交接写 `handoff.human` 事件，不硬塞成 Assignment；交接事件里带 `reason` 和 `actionRequired`。
- 复核轮次在发起时把验收员固定到 `stages[i].reviewers`；之后加验收员只影响下一轮，不回头要求新成员对上一轮的证据补判定。
- 加成员只影响之后的交接：只能加执行官或验收员，规划师唯一且不能移除；当前阶段的 assignees 和在跑的复核轮次不改；有未结束交接的成员不能移除。
- 派发状态和阶段任务从 Assignment 现算，不写回房间；交接卡按 id 找记录，按引用取证据。
- 返工指向被退回的那条；复核指向被复核的执行；收尾和例外决定分别指向刚才那条复核。
- 历史分页 `GET /api/rooms/:id/assignments`；每房保留最近 2000 条终态交接，未收口的不清理。

## 状态与事件

- **真相是状态表，不是事件流。** 房间、轮次、阶段、交接、聊天阶段、work item、审批都是显式状态；`room_event` 是追加日志，用于审计、幂等和重放，不用来重建全部状态。这不是完整的事件溯源。
- **事件覆盖**：房间创建、暂停/恢复/归档/成员错误，轮次开始与终态，阶段派发/通过/重做/退回，交接的每次状态变化（含复核、收尾、例外决定），交给人，复核请求/判定/超时，验收命令，自动重做停止，聊天阶段变化和总结。
- **没有做的事**：没有 command/projection 两套写路径，没有事件版本与 upcaster，没有事件级快照；事件保留上限 5000 条，旧事件会被裁剪；交接事件在状态提交之后写，写失败只警告、不回滚业务状态。
- **重放范围**：`npm run replay:round -- --room <id> [--round <id>]` 只重建工作室一轮的阶段状态和交接状态，不重建消息正文、verdict 内容、证据文件或聊天轮次。`round.started` 带阶段快照；没有快照的旧轮次只能重放交接并给出 warning。重放只报告差异，不改写状态。
- **项目状态**：project 只是轮次分组和北极星，没有独立生命周期；它不参与门禁、不执行、不验收。页面上说的“进行中/已交付”是最近一轮的轮次状态，不是 project 状态。project 记录里没有 status 字段。
- **扩展路线**：如果“可追溯”成为产品需求，只对轮次生命周期做事件溯源（事件成为写入口，补事件版本和快照），消息、证据和交接仍保持状态表；不把整间房的数据改成事件流。

## 执行与验收

- 规划师派发给执行官；证据就绪后系统请求验收员复核。默认接力由 `server/crew/rooms/studio/relay.js` 决定：验收退回直接交回执行官；通过时中间步骤自动收口并派发下一步，最后一步交回规划师收尾；只有重做预算用完、合并冲突或没有可执行成员时才回到规划师/人。
- 自动交付：房间字段 `autoDeliver`，创建时可选、默认关。最后一步验收通过后系统以 `by: 'system'` 收口并完成这一轮，不再等人工确认；只认判定工具提交的结构化 PASS（带 diff 外风险），文本兜底仍交给人收。门禁不满足就退回人工确认。中间步骤的自动推进不受这个开关影响。
- 工作室只有一个共享房间：派发、复核、退回、通过都由系统在群聊发一条带 @ 的投影；投递不依赖模型点名。工作室建房时在基座写 `followMentions: false`，成员回复里的 @ 不再唤醒下一棒；聊天室保留成员互相 @ 接话。私有 worktree 只是执行目录，不承载对话，也不做 @ 寻址；并行投递走成员执行上下文，群聊仍只有一套。
- 用户停下回复走 `interrupt`：取消当前回合和未终态交接，房间保持 `active`；不写 `pauseReason`，也不要求再点继续。
- 验收命令在一次性副本里跑，记录命令、退出码、输出、diff 和改动文件。
- 多个执行官并行时各在自己的 worktree 里做，结束后集成；冲突停下交给人。
- 验收员只读 + exec，不能写；没有第二厂商时明确标「模型自查」。
- 三条方法硬约束：交付阶段的检查必须是一条能跑的命令；命令验收的阶段，改代码就必须带测试改动；验收 PASS 必须写一条 diff 之外的风险（没有写「无」）。前两条在建房和签收时拦，第三条在判定工具入口拦，不靠提示词自觉。
- 人确认后阶段收口；最后一步与「验收与结论」合并，不让人为同一个判断点两次。

## 角色技能与房间投影

- `shared/role-toolbox.js` 是三角色常驻技能的唯一清单。技能文件在 `skills/role-packs/`，由 `server/skill-packs.js` 在组合根通过基座技能库导入并审核；不改基座源码。

| 房型 / 角色 | 技能 | 形态 |
|---|---|---|
| 规划师 | `lodge-plan`、`lodge-design` | 2 个基座技能 |
| 执行官 | `lodge-build`、`lodge-diagnose`、`lodge-ui` | 3 个基座技能 |
| 验收员 | `lodge-review`、`lodge-ui`、`lodge-security` | 3 个基座技能 |
| 聊天室成员 | 不挂工程技能；只读文件、只读公网、`chat-voice`、`chat-stances` | 提示模块 |
| Lodge 主机器人 | `listen / auto-grill / route / close`（`LODGE_HOST_RULES`） | 内置提示，不占基座技能 |
| 房间层 | `room-issues`、`room-retro` | 只读投影，不是技能 |

- 共 7 个唯一基座技能、8 个角色挂载；`lodge-ui` 由执行官和验收员共用。合并前的 18 个技能已停用，名字留在 `RETIRED_SKILLS` 里，旧成员换身体或自定义时会被清掉，不再挂载。
- 聊天室没有 `grill-me`，也没有工程技能；主机器人自己判断何时追问，聊天成员只保留表达、席位和只读上下文。
- 成员技能仍走 `member.skills → body.spec.skills → engine.setBotSkills`。`body.js` 和 `body-swap.js` 合并角色技能：内置在前，自定义追加，最多 8 个；旧房间换身体时补上角色包。成员详情里的技能列表和 MCP 列表是只读展示：技能从角色包读，MCP 从成员授权读，不在成员卡里改。
- 技能的“调用”分三段：Lodge 只负责挂载（`engine.setBotSkills` → 基座 `PUT /api/bots/:id/skills-library`，名单存为 bot 的 `assignedSkills`）；基座每轮把技能索引写进系统提示（一行一条：名称、描述、`SKILL.md` 路径）；模型判断命中后用文件工具读全文。Lodge 不执行技能内容，`SKILL.md` 是方法说明，不是权限。
- 挂载有三道保证：启动时 `ensureRoleSkillPacks` 把包导入并审核，失败记 `ready=false`，不静默；建房前 `create.js` 检查 ready 和 `features.skillsLibrary`，不过就在造工作区前拒绝；`body.js` 挂技能失败会删掉刚建的 bot，建房失败。索引只对支持 workspace 文件的引擎注入（Claude Code、Codex 有；grok、openai-compat 没有），单成员最多 8 条，基座索引上限 30 条 / 4000 字节。
- 模型是否真读某个 `SKILL.md` 由模型判断，机制上不强制；能强制的是验收门禁和角色规则。核对看启动日志 `role skill packs: 7 ready`，或 `GET /api/bots/<id>/skills-library` 的名单。
- 规划师只有两个技能：`lodge-plan` 管问清、写小规格和拆阶段；`lodge-design` 管术语、边界和契约。`grill-with-docs`、`to-spec`、`to-tickets` 不装原版，避免多出 GLOSSARY/ADR、spec 文件或外部 ticket 三个真相源。
- 聊天成员是 `participant`，不继承工程技能；只有只读文件、只读公网、`chat-voice` 和 `chat-stances`。外部动作仍由审批桥拦住。聊天室必须使用支持逐次确认的引擎；不会问人的模型在建房前就被拒绝，不能把只读写在提示词里假装实现。
- 验收员用 `lodge-review`：先自己跑验收命令，再做 Spec 轴和 Standards 轴，两份报告并列，只在各自轴内排序；不引入 subagent，也不把两轴合并成一个分数。
- `shared/room-issues.js` 和 `shared/room-retro.js` 是只读投影，不是技能：在每次组装房间视图（`presentRoom`）时直接算，模型看不到，也不花 token。工作室把阶段投成 issue，聊天把结论/待办投成 issue；复盘只引用真实返工、超时或用满轮次。它们不写房间状态，也不新增角色。

## 附件与视觉证据

- 附件不落房间存储：上传是 `POST /api/attachments` 的薄代理，文件进基座附件库；消息只带 `meta.attachments` 和 `<attached-image>` / `<attached-file>` 标记。
- 图片由 harness 转成原生输入；文本文件带正文，其它文件留路径；数量、大小和路径形状在消息动作里校验。
- HTML 交付在复核前由平台渲染成图：`screenshot.js` 调本机无头 Chrome，`visual-audit.js` 做像素检查，`previews.js` 记到房间。底座浏览器挡本地文件，这一层暂时由平台驱动 Chrome，是明确例外。
- 验收判定可带 `visual: { seen, colors, contrast }`；平台在交付卡上区分「没核对」「没看到」「看到」。成员 `body.capabilities` 记录声明的图片和工具能力，声明不是验证。
- 验收员选身体时先选声明能看图的实例，其中再优先不同厂商；没有能看图的才退回跨厂商复核。

## 边界靠测试固定

- `layer-boundaries.test.js`：应用层不 import 具体适配器；业务不解析基座地址；提示词不发送消息。
- `negative-list.test.js`：聊天室不读工作室状态；工作室不读 `room.chat`；共享内核只通过房型契约；提示词不按任务内容分支。
- `rooms/kinds.test.js`：两套房型实现同一组 mode / presentation / lifecycle 契约。
- `architecture.test.js`（UI）：共享 UI 不比较 `roomType`；房型视图只通过 kind 注册。
- `boundary.test.js`、`assignment.test.js`：领域边界与交接生命周期。
- `evals/planning/`：规划质量对照；`evals/rooms/`：房间交付固定题，外部脚本核对产出，不追求单次最好成绩。

## 已知边界

- 单用户、本地仓库、本地 CLI；不是云端或多人组织。
- 不是通用文件系统沙箱；没做的隔离不说做了。
- 截图由平台驱动 Chrome，是当前例外；之后可收成工具。
- 验收员声明能看图，不等于运行时真的看见；`seen` 才是事实。

## 许可

产品 MIT；OpenMausBot OSS 的 runtime、drivers、Electron 壳为 Apache-2.0；Pi 为 MIT。第三方 notices 随包。
