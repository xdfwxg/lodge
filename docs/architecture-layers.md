# Lodge 分层与依赖

> 原则：层内内聚，层外解耦。判断标准不是行数，而是这段逻辑是否是一个不可拆分的整体。

## 1. 层

| 层 | 职责 | 代表模块 |
| --- | --- | --- |
| 领域规则 | 纯业务判断：预算、门禁、验收结论、阶段依赖、席位能力、房型策略、注意力、交接摘要 | `budget.js`、`gates.js`、`verifiers.js`、`stage-plan.js`、`progress.js`、`result.js`、`attention.js`、`digest.js`、`delivery.js`、`seats.js`、`room-types/*`、`service-policy.js`、`live-turn-utils.js`、`mcp*.js` |
| 应用用例 | 编排一次业务动作：建房、完成、席位、阶段、交付、实时回合、审批、恢复、启动修复、工作区 GC | `room-create*.js`、`room-complete.js`、`room-record.js`、`room-workspace.js`、`room-provision.js`、`service-*.js`、`live*.js`、`live-workspace.js`、`startup-repair.js`、`room-repair.js`、`workspace-gc.js`、`dispatch-service.js`、`demo.js`、`handoff.js`、`review.js`、`resources.js`、`roster-recommend.js`、`presentation.js` |
| 端口 | 给应用层一组稳定接口，屏蔽具体存储/工作区/项目/用量/模板/交付/命令/文件/交接包实现；组合根装配整包，再按模块分发子端口 | `crew-ports.js` |
| 适配器 | 文件、SQLite、基座、git/worktree、直接目录、复制目录、进程、沙箱、系统对话框 | `store.js`、`engine.js`/`base.js`、`workspace*.js`、`room-repo.js`、`handoff-store.js`、`seat-env.js`、`paths.js`、`project.js`、`usage-history.js`、`template-store.js`、`delivery-ledger.js`、`acceptance.js`、`sandbox.js`、`lock.js`、`system-*.js` |
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
- 叶子模块只接收自己需要的子端口；`service.js`/`live.js`/`room-create.js` 是应用层内的组合边界，负责把子端口分发给叶子模块。
- `crew-ports.js` 只在 `server/index.js` 实例化；它是唯一直接接触适配器的模块。
- `server/index.js` 只做装配与传输，不写业务规则。
- UI 只通过 `store.js` / `system.js` 走 HTTP 与 Electron bridge，不 import `server/crew`。

## 3. 划分理由

| 划分 | 为什么是不可拆分的整体，或为什么可以独立 |
| --- | --- |
| `room-create-input.js` | 目标/房型/验收、开工卡、续做 BRIEF、席位组合、项目约束是同一份“建房输入”的归一化；拆开后会重复校验顺序 |
| `room-workspace.js` | 工作区选择、探测、准备、席位 env 是同一件事：把源目录变成可执行房间 |
| `room-provision.js` | 基座席位线程、房间线程、引擎降级、独立性判定必须一起完成；单独存在没有业务意义 |
| `room-record.js` | 房间记录、约束、初始消息是同一份持久化事实，拆开会出现字段漂移 |
| `room-create-start.js` | 首次派发依赖已建好的房间记录、席位与工作区，不能先于它们运行 |
| `room-create.js` | 保留为入口与失败补偿：只有它同时看到预置、记录、启动三段，能在失败时统一回滚 |
| `room-complete.js` | 完成是独立业务事件：清理工作区、写 CONCLUSION、commit/归档；与阶段验收不是同一变化原因 |
| `service-queries.js` | 只读投影：房间状态、资源、用量、复盘、项目约束，读模型一起变化 |
| `service-templates.js` / `service-delivery.js` | 模板与交付各有自己的存储与格式，修改互不影响 |
| `handoff.js` + `handoff-store.js` | 交接包校验/脱敏是不可拆分整体；房间文件读写是另一个变化原因，下沉到 handoff 存储适配器 |
| `workspace-gc.js` | 工作区 GC 是独立维护用例；目录遍历、stat、删除通过 files/workspace 端口，不直接碰 fs |
| `service-seats.js` + `service-seat-add.js` / `service-seat-remove.js` | 加/移除是独立工作区生命周期；改角色不是独立单元，只是复用两者的编排，收在 `service-seats.js` 门面里 |
| `service-stages.js` | 阶段编辑、验收、签字属于同一阶段门禁；完成态已拆出 |
| `service-run-control.js` | 预算、暂停/继续/停止、MCP 恢复都属于运行控制面；恢复后启动当前阶段共用同一个私有 helper |
| `live-projection.js` | 基座消息到 Lodge 时间线的映射是纯转换，可单独测试 |
| `live-refresh.js` | 忙闲、用量、预算暂停是同一轮房间刷新 |
| `live-approvals.js` | 权限卡、外部动作、待批准记录、失效与人工决定必须一起处理，拆开会出现审批状态不一致 |
| `live-sync.js` | 席位历史同步与实时订阅共享同一套消息入口 |
| `live-turns.js` | 保留为回合入口；状态、验收、集成、复核、派发已经是独立整体 |
| `crew-ports.js` | 不是业务拆分，而是接口层：上层只依赖它，适配器变更不穿透应用层 |

## 4. 明确不拆

- 领域规则不再拆成更小的函数文件：`gates.js`、`verifiers.js`、`stage-plan.js` 本身就是单一判定单元。
- `room-types/*` 是房型策略，每个房型一个整体；不把阶段、席位、验证方式拆散。
- `workspace-git.js` / `workspace-direct.js` / `workspace-plain.js` 各自是一个完整工作区实现；共用 helper 才下沉。
- `live-turns.js` 不再按函数切碎；它只做回合入口与组合，内部模块已按变化原因拆开。
- `new-room-dialog.js` 是一个多步表单流，状态与步骤共享；强行拆步骤会引入跨文件状态同步。
- `service-queries.js` 保持读模型门面，不为每个查询建一个文件。

## 5. 门禁与现状

- `server/crew/layer-boundaries.test.js`：应用模块不得 import 具体适配器，也不得 import `crew-ports.js`；ports 必须由组合根注入。
- `server/crew/boundary.test.js`：crew 不出现基座字段；git 只在 workspace provider 与默认根探测。
- `ui/src/architecture.test.js`：UI 传输只在 `store.js` / `system.js`；视图不 import store。
- 当前依赖图：110 个非测试模块、185 条内部依赖、0 个循环。
- 测试：259 项通过。
