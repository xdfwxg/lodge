# Lodge 分层与依赖

> 原则：层内内聚，层外解耦。判断标准不是行数，而是这段逻辑是否是一个不可拆分的整体。

## 1. 层

| 层 | 职责 | 代表模块 |
| --- | --- | --- |
| 领域规则 | 纯业务判断：预算、门禁、验收结论、阶段依赖、席位能力、房型策略、编排策略、注意力、交接摘要 | `budget.js`、`gates.js`、`verifiers.js`、`stage-plan.js`、`progress.js`、`result.js`、`attention.js`、`digest.js`、`delivery.js`、`seats.js`、`room-types/*`、`orchestration/*`、`service-policy.js`、`rooms/studio/turn-utils.js`、`mcp*.js` |
| 应用用例 | 编排一次业务动作：建房、完成、席位、阶段、交付、实时回合、审批、恢复、启动修复、工作区 GC | `rooms/create/*`、`rooms/studio/*`、`kernel/live/*`、`rooms/base/live.js`、`rooms/chat/*`、`service-*.js`、`workspace-gc.js`、`dispatch-service.js`、`resources.js`、`roster-recommend.js`、`presentation.js` |
| 端口 | 给应用层一组稳定接口，屏蔽具体存储/工作区/项目/用量/交付/命令/文件/交接包实现；组合根装配整包，再按模块分发子端口 | `crew-ports.js` |
| 适配器 | 文件、SQLite、基座、git/worktree、直接目录、复制目录、进程、沙箱、系统对话框 | `store.js`、`engine.js`/`base.js`、`workspace*.js`、`room-repo.js`、`handoff-store.js`、`seat-env.js`、`paths.js`、`project.js`、`usage-history.js`、`skill-store.js`、`acceptance.js`、`sandbox.js`、`lock.js`、`system-*.js` |
| 组合与接口 | 装配具体实现；HTTP/SSE；Electron 与 Web 传输 | `server/index.js`、`electron/*`、`ui/src/store.js`、`ui/src/system.js` |

## 2. 依赖方向

```text
UI（views / store / system）
  → HTTP / SSE
server/index.js（唯一组合根）
  → service.js / live.js
  → 应用用例
      → 领域规则
      → crew-ports.js
          → 适配器（store / engine / workspace / room-repo / ...）
```

约束：

- 领域规则不 import 应用层、端口或适配器。
- 应用层只 import 领域规则，通过参数接收端口；不 import 具体适配器，也不自己创建 ports。
- 叶子模块只接收自己需要的子端口；`service.js`/`rooms/base/live.js`/`rooms/create/create.js` 是应用层内的组合边界，负责把子端口分发给叶子模块。
- `crew-ports.js` 只在 `server/index.js` 实例化；它是唯一直接接触适配器的模块。
- `server/index.js` 只做装配与传输，不写业务规则。
- UI 只通过 `store.js` / `system.js` 走 HTTP 与 Electron bridge，不 import `server/crew`。

## 3. 划分理由

| 划分 | 为什么是不可拆分的整体，或为什么可以独立 |
| --- | --- |
| `rooms/create/input.js` | 目标/房型/验收、开工卡、续做 BRIEF、席位组合、项目约束是同一份“建房输入”的归一化；拆开后会重复校验顺序 |
| `rooms/create/workspace.js` | 工作区选择、探测、准备、席位 env 是同一件事：把源目录变成可执行房间 |
| `rooms/create/provision.js` | 基座席位线程、房间线程、引擎降级、独立性判定必须一起完成；单独存在没有业务意义 |
| `rooms/create/record.js` | 房间记录、约束、初始消息是同一份持久化事实，拆开会出现字段漂移 |
| `rooms/studio/start.js` | 首次派发依赖已建好的房间记录、席位与工作区，不能先于它们运行 |
| `rooms/create/create.js` | 保留为入口与失败补偿：只有它同时看到预置、记录、启动三段，能在失败时统一回滚 |
| `prompt-modes.js` | 席位 soul 只留身份与沟通；工作纪律按 role、房型模式按 roomType/stage 装配，派发/复核/起步共用这一份，避免聊天带入工作 SOP |
| `skill-store.js` | 可选能力库只做 id→正文读取与目录投影；路径校验、大小上限、正文不进房间记录 |
| `trust.js` + `service-trust.js` | 信任级别是同一策略单元：证据判定、升级/降级、审计消息；`observe` 只读、`verify` 人工签字、`auto` 只放行规则守门 allow 的外部动作 |
| `rooms/studio/complete.js` | 完成是独立业务事件：清理工作区、写 CONCLUSION、commit/归档；与阶段验收不是同一变化原因 |
| `service-queries.js` | 只读投影：房间状态、资源、用量、复盘、项目约束，读模型一起变化 |
| `rooms/studio/service-delivery.js` | 交付单格式与导出是独立变化原因 |
| `rooms/studio/handoff.js` + `handoff-store.js` | 交接包校验/脱敏是不可拆分整体；房间文件读写是另一个变化原因，下沉到 handoff 存储适配器 |
| `workspace-gc.js` | 工作区 GC 是独立维护用例；目录遍历、stat、删除通过 files/workspace 端口，不直接碰 fs |
| `service-seats.js` + `service-seat-add.js` / `service-seat-remove.js` | 加/移除是独立工作区生命周期；改角色不是独立单元，只是复用两者的编排，收在 `service-seats.js` 门面里 |
| `rooms/studio/service-stages.js` | 阶段编辑、验收、签字属于同一阶段门禁；完成态已拆出 |
| `service-run-control.js` | 预算、暂停/继续/停止、MCP 恢复都属于运行控制面；恢复后启动当前阶段共用同一个私有 helper |
| `kernel/live/projection.js` | 基座消息到 Lodge 时间线的映射是纯转换，可单独测试 |
| `timeline.js` | 只负责按时间渲染消息记录；当前阶段动作不在这里，避免“永远钉底” |
| `stage-gate.js` | 阶段门纯投影：当前阶段、返工地板、PASS/证据与“是否需要人”的判定；不依赖 React，可单独测试 |
| `stage-controls.js` | 阶段门的展示与动作：确认卡、真实验收卡、演示卡、返工输入；它们共享同一套阶段动作，拆开会让按钮与证据判断漂移 |
| `stage-dock.js` | 只做阶段门的开关、当前阶段选择与三种卡片的组合；不持有阶段判定规则 |
| `opening-points.js` | 开工卡已对齐内容同时被开工记录和阶段确认使用，投影只此一份 |
| `kernel/live/refresh.js` | 忙闲、用量、预算暂停是同一轮房间刷新 |
| `kernel/live/approvals.js` | 权限卡、外部动作、待批准记录、失效与人工决定必须一起处理，拆开会出现审批状态不一致 |
| `kernel/live/sync.js` | 席位历史同步与实时订阅共享同一套消息入口 |
| `rooms/studio/turns.js` | 保留为回合入口；状态、验收、集成、复核、派发已经是独立整体 |
| `orchestration/*` | 编排策略是独立变化原因：每个策略只回答“这一阶段怎么派、验收要补什么要求”；注册表与 `planDispatch`/`reviewGuidanceFor` 是唯一出口，执行层不认识具体策略 |
| `orchestration/assignees.js` | 规划师提案 token 到执行席位的映射只有这一份规则；建房输入和开工卡解析都复用它，避免两处漂移 |
| `seat-labels.js` | 角色显示名与基座 handle 的边界转换只有一处；映射来自房间数据，不用枚举写死名字；房间记录存人话，发给基座前才转换 |
| `kernel/live/bus.js` | 房间聊天只有这一个变化原因：建共享群聊、订阅、发消息、退回投影；不参与阶段回合，不产出证据。执行层不认识聊天细节 |
| `room-chat.js` | 群公告与群名是建房和重连共享的常量，只此一份，避免两处漂移 |
| `crew-ports.js` | 不是业务拆分，而是接口层：上层只依赖它，适配器变更不穿透应用层 |

## 4. 明确不拆

- 领域规则不再拆成更小的函数文件：`rooms/studio/gates.js`、`rooms/studio/verifiers.js`、`rooms/studio/stage-plan.js` 本身就是单一判定单元。
- `room-types/*` 是房型策略，每个房型一个整体；不把阶段、席位、验证方式拆散。
- `orchestration/*` 是编排策略，每个策略一个派发形状；不把 `planStage` 再拆成“选人/并行/附注”三个文件，也不把策略名写进执行层或 UI。
- `workspace-git.js` / `workspace-direct.js` / `workspace-plain.js` 各自是一个完整工作区实现；共用 helper 才下沉。
- `rooms/studio/turns.js` 不再按函数切碎；它只做回合入口与组合，内部模块已按变化原因拆开。

## 分层与不可拆分单元（2026-11-14）

按“层内内聚，层外解耦”落地后的层次：

| 层 | 职责 | 位置 |
|---|---|---|
| 领域规则 | 只判断，不做 IO：房型、席位、状态机、门禁、验收、阶段、编排、预算 | `room-types/*`、`seats.js`、`room-state.js`、`orchestration/*`、`rooms/studio/{gates,tasks,progress,stage-plan,verifiers,gate,turn-utils}.js` |
| 上下文应用 | 一个房间上下文的完整行为：聊天讨论 / 工作室阶段执行 | `rooms/chat/*`、`rooms/studio/*` |
| 共享实时内核 | 两种房型共用的群聊接入：收发、回显、投影、刷新、席位订阅、审批 | `kernel/live/{bus,projection,refresh,sync,approvals}.js` |
| 共享用例 | 跨房型但不可分割的建房流水线：输入校验 → 席位 → 工作区 → 基座预置 → 房间记录 → 首次派发 | `rooms/create/{create,input,record,provision,workspace}.js` |
| 端口与适配器 | SQLite、基座 HTTP、工作区、房间记录文件、锁、验收副本 | `store.js`、`workspace*.js`、`room-repo.js`、`handoff-store.js`、`lock.js`、`sandbox.js`、`acceptance.js`、`server/base.js`、`server/engine.js` |
| 组合根 | 只装配，不写业务规则 | `server/index.js`、`rooms/base/live.js`、`service.js`、`rooms/kinds.js` |

不可拆分整体及理由：

- **建房流水线**：每一步都为失败补偿服务（建席位失败要删 bot、预置失败要删房间、记录失败要回滚工作区），拆成独立服务会丢补偿上下文，所以收在 `rooms/create/`。
- **共享实时内核**：回显、流式、去重、同步、审批共享同一套基座群聊语义，拆开会出现两套消息真相，所以收在 `kernel/live/`。
- **聊天讨论**：随机发言、上限、总结、结论卡和拍板共享同一份 `room.chat` 状态，不能再拆。
- **工作室阶段执行**：阶段派发、执行回合、验收、返工、集成共享同一份阶段/证据状态，不能再拆。
- **领域规则**：纯判断不依赖 IO，可被两套上下文和测试同时复用，因此独立成层，但不按函数继续切碎。

禁止的拆法：把创建拆成“校验服务/预置服务/记录服务”；把投影从总线拆出；把上下文内部再切 domain/app 空目录；为单一实现预造 Remote 适配器。

## SOLID 落点与接口（2026-11-14）

- 房间是唯一实体：`room` 记录、表、消息、席位和工作区只有一份；聊天/工作室是 `RoomMode` 策略变体，不是两套实体或两张表。
- 单一职责：`kernel/live` 只处理群聊接入；`rooms/create` 只处理建房；`rooms/<mode>/runtime.js` 只做该模式的本地装配；`facade.js` 只输出只读 DTO。
- 开闭原则：新增运行模式只需新增一个 mode 目录并在 `rooms/kinds.js` 注册一行；共享层和 UI 壳不改判断逻辑。
- 里氏替换：每个 mode 实现同一契约，`rooms/kinds.test.js` 校验所有 mode 都具备必需钩子；共享代码只按契约调用。
- 接口隔离：共享层拿两个窄接口——`roomMode*`（建房/能力/权限）和 `roomPresentation*`（过滤/投影/注意力/刷新），不再拿整个房型对象。
- 依赖倒置：应用层依赖 `store`/`engine`/`workspace` 端口与 mode 契约，`server/index.js` 注入具体适配器；共享层不 import 适配器。

| 对外接口 | 提供给谁 | 内容 |
| --- | --- | --- |
| `roomModeForType` / `roomModeOfRoom` | 建房、席位、服务能力判断 | 席位角色、验房、建房记录、初始消息、预置、启动、门禁、能力位 |
| `roomPresentationOfRoom` | 消息内核、注意力、查询与资源投影 | 消息过滤、活动隐藏、流式开关、需要人、阶段状态、刷新、席位失败 |
| `facadeOfRoom` / `snapshotOfRoom` | 跨上下文/只读查询 | 版本化瘦 DTO（chat 的 phase/turns/host；studio 的 closure/stages/delivery） |
| `runtime` 工厂 | 组合根 | attach/start/cancel/permission 等运行时行为；当前只有本地适配器 |

明确不做：不为单一模式预造远程运行时；不把 mode 再拆成 domain/app/infra 空层；不把 `Room` 拆成 ChatRoom/StudioRoom 两个实体。

## 上下文边界（2026-11-14）

聊天室和工作室是两个限界上下文，共享内核只保留存储、基座总线、席位身份和通用注意力。

- `rooms/<context>/runtime.js` 是上下文运行时（工厂 + 适配器），负责挂载、装配和部署形态切换；它不是策略模式，也不用于在聊天室/工作室之间换算法。
- `rooms/<context>/kind.js` 提供建房、记录、消息投影、权限和注意力钩子；共享应用层只调用钩子，不写 `roomType === ...`。
- `rooms/<context>/facade.js` 是跨上下文只读门面，返回带版本号的瘦 DTO；调用方不得直接读对方的 `chat/chatHost/stages/closure` 或仓储。
- 策略模式只放在上下文内部，例如消息持久化、通知下发、文档快照；只有出现第二种实现时才建 `strategy/`。
- `negative-list.test.js` 固化：chat 与 studio 互不 import；`live-*`、`attention`、`presentation`、`resources`、`service-queries`、`room-create*`、`room-record`、`room-provision` 不得直读上下文状态。
- UI 同样通过 `room/kinds.js` 取上下文 kind；`architecture.test.js` 禁止共享 UI 比较 `room.roomType`，也禁止 chat/studio UI 互 import。
- 数据库仍是共享实现：`messages` 按 `roomId` 隔离，不做跨上下文 join；将来拆服务时，Facade 可直接替换成 HTTP/gRPC 客户端。
- `new-room-dialog.js` 是一个多步表单流，状态与步骤共享；强行拆步骤会引入跨文件状态同步。
- `service-queries.js` 保持读模型门面，不为每个查询建一个文件。

## 5. 门禁与现状

- `server/crew/layer-boundaries.test.js`：应用模块不得 import 具体适配器，也不得 import `crew-ports.js`；ports 必须由组合根注入。
- `server/crew/boundary.test.js`：crew 不出现基座字段；git 只在 workspace provider 与默认根探测。
- `ui/src/architecture.test.js`：UI 传输只在 `store.js` / `system.js`；视图不 import store。
- 当前依赖图：115 个非测试模块、194 条内部依赖、0 个循环。
- 测试：311 项通过。
