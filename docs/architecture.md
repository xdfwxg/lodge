# Lodge 房间模型：ChatRoom / WorkRoom

> 目标架构。当前实现状态以 `docs/reuse-map.md` §8.5 为准；本文只定义不可随意突破的边界。

Lodge 底层将房间划分为两类，房间类型创建时确定，运行期不可切换，绑定两套独立引擎：

- `chat`：对话引擎
- `studio`：交付引擎

核心原则：严格区分「对话共识范式」与「可验收交付范式」，两套状态机、数据结构、能力体系完全隔离；工作室所有业务岗位基于 3 种本原角色派生，不新增底层角色原语。

状态机落点：`server/crew/room-state.js` 保存两张独立转移表，只做 `状态 + 事件 + context → 下一状态/拒绝原因` 的纯判断。所有 `closure` 和 `room.chat.phase` 写入必须经过它，并写 `closure.transition` / `chat.transition` 审计事件。聊天机与工作室机不共享状态、不发跨机事件。

### 状态机转移表

工作室 `closure`：

| 当前状态 | 事件 | Guard | 下一状态 |
| --- | --- | --- | --- |
| `open` | `plan_submitted` | 有方案 | `planned` |
| `open` | `start_execute` | 无计划房间 | `executing` |
| `open` | `stage_advanced` | 决策阶段通过 | `planned` |
| `open` | `await_sign` | 只剩最终结论 | `verifying` |
| `planned` | `start_execute` | 计划已确认 | `executing` |
| `planned` | `reject_plan` | 仅计划阶段 | `rejected` |
| `planned` | `stage_advanced` | 决策阶段通过 | `planned` |
| `planned` | `await_sign` | 只剩最终结论 | `verifying` |
| `executing` | `submit_evidence` | 命令 exit 0 或人工证据 | `verifying` |
| `executing` | `stage_advanced` | 决策阶段通过 | `planned` |
| `executing` | `await_sign` | 只剩最终结论 | `verifying` |
| `verifying` | `verdict_pass` | 验收票已记录 | `verifying` |
| `verifying` | `verdict_reject` | Verifier 打回 | `executing` |
| `verifying` | `stage_advanced` | 非最终阶段通过 | `planned` |
| `verifying` | `await_sign` | 只剩最终结论 | `verifying` |
| `verifying` | `sign` | Verifier PASS + 人工签字 | `signed` |
| `signed` / `rejected` | 任意 | 终态 | 拒绝 |

聊天室 `room.chat.phase`：

| 当前状态 | 事件 | Guard | 下一状态 |
| --- | --- | --- | --- |
| `discussing` | `summarize` | 达到发言上限 | `summarizing` |
| `discussing` | `abort` | 调度中止或继续失败 | `discussing` |
| `summarizing` | `conclude` | 主持人总结完成 | `awaiting_decision` |
| `summarizing` | `abort` | 调度中止 | `discussing` |
| `awaiting_decision` | `accept` | 人工认可 | `accepted` |
| `awaiting_decision` | `continue_discuss` | 人工要求继续 | `discussing` |
| `accepted` | 任意 | 终态 | 拒绝 |

初始化（`room-record.js` 新建房间）、旧数据迁移（`store.upgradeRoom`）和聊天调度启动复位是唯一允许直接写初始值的地方；运行期状态变化一律走转移函数。`origin`、`advisor` 建议、模型标签只作为 context，不参与 Guard。

证据账本：`evidence` 表只追加命令证据和人工产物证据（`kind: command | manual`），每条带 `id / roomId / seq / digest / meta / text / authorId / at`；执行席位的自述回合（`kind: turn`）留在消息流，不进账本。Verifier、Gate、信任阶梯只按账本选择本轮凭证，verdict 只引用 `evidenceId`。旧房间第一次读账本时从已有命令/人工证据消息补账，不改历史消息。`GET /api/rooms/:id/evidence-ledger` 提供只读列表。

状态回放调试器：`GET /api/rooms/:id/transitions` 只读读取 `closure.transition` / `chat.transition`，复用同一张转移表重放并校验历史，输出每一步的 `from / to / event / actor / reason / context` 与非法或断链原因；不写房间、不补事件。UI 入口在高级面板的“状态回放”。

## 1. ChatRoom 聊天室

- 引擎：`chat` 对话引擎
- 底层角色原语：仅 `participant`；主持人通过布尔标记 `isHost: true` 区分，不复用 planner 语义
- 独立状态：`room.chat`，自有字段：`round`、`phase: discussing | summarizing | awaiting_decision | accepted`、`turnLimit`（默认 6，建房可配置）、`turns`、`conclusionId`、`accepted`
- 边界约束：**不使用工作室的 closure / stages / gates / evidence / verdict 体系**。聊天室的结论确认只是对话规则收尾，不属于交付门禁、不进入信任阶梯。
- 能力：自由讨论、圆桌对齐、头脑风暴；轮次上限是房间参数，不是引擎常量；仅开放低风险只读工具，不挂载 Pi 完整执行引擎。
- 无 Gate 前置管道，无开工卡，无强制验收闭环。
- 结论确认后可用“用结论新建工作室”：只是打开普通建房弹窗并预填目标文本，不是房间转换，也不导入聊天状态。

## 2. WorkRoom 工作室

- 引擎：`delivery` 交付引擎
- 底层角色原语（`roleKind`，数据库 / 权限 / trust / driver 识别的唯一原语）：
  - `planner`：接收目标、拆解任务、定义验收标准、分派、协调分支
  - `executor`：依据方案执行，产出交付物 + 结构化证据包
  - `verifier`：独立鉴证，对照证据包与验收标准产出 verdict；评估建议仅提供辅助打分，不具备最终决策权
- `roleProfile`：上层业务标签（gate-coordinator、architect、qa-reviewer、retro-analyst 等），仅用于 UI、提示词、playbook，不影响底层权限与流转。
- 前置管道 Gate：独立于三类本原角色，在 Planner 启动规划前运行；输入目标，输出 allow / reject、理由、评估建议；Gate 只控制准入，不拆解任务、不写方案。
- 工作室流转 `closure` 状态：`open | planned | executing | verifying | signed | rejected`
  - `rejected`：仅 Planner 在 `planned` 阶段可触发，附带理由与证据；属于合法终态，**标记为不可行，不等于任务完成**
  - 一旦进入 `executing`：所有驳回、通过判定权限收归 Verifier，Planner 不能单方面终止或放行
  - 验收模式 `verificationMode: bot | human | hybrid`：人工验收不旁路，人工评审同样产出标准 verdict 记录；多 Verifier 的 `verifierPolicy: all | majority` 是调度策略，`swarm` 只是它的运行形态，不是新增底层角色
  - 独立性策略 `independencePolicy: prefer | require`：默认 `prefer`，优先把验收放到不同厂商并在降级时明确标注；`require` 在没有第二厂商或实际仍同厂商时拒绝建房，不静默降级
- 内置底座：开工卡状态机、审批卡、权限卡、信任阶梯 `trust.js`、证据持久化、loop 迭代闭环。验收按阶段幂等：执行者没有工具调用或产出的闲聊回合不触发新的命令验收；没有新增交付改动时沿用已完成的验收，不重复提交候选。
- 流转公约：主任务闭环必须经过 Planner → Executor → Verifier；支持子任务并行、重试、分支，但进入执行阶段后不可绕过 Verifier 放行。
- 子工作室：最多 3 层，子房必须是 studio；父 Planner 只接收子工作室 Verifier 的 verdict，不重审子房证据细节。子房完成后会以 `child_result` 消息回到父房，并唤醒父 Planner。高级面板以树视图展示父子状态与子房 verdict，父房只读，不提供修改子房内部流转的动作。
- 影子评审 `shadowReview`：开启后 advisor 照常打分，但只写入时间线和 `meta.shadow`，不注入 Verifier prompt、不产生正式 verdict；关闭时 advisor 建议可作为参考进入 Verifier prompt。两种情况下正式 Verifier 都必须 PASS 才能 signed。
- Planner 工具面：Lodge 自带一个按房间注册的无状态 MCP server（`/mcp/planner/<roomId>`，令牌绑定房间），只挂给该房间的 Planner，提供 `create_subroom`、`reject_plan`、`check_gate`；工具调用回到业务层执行，结果由 MCP 返回，Planner 不能伪造。MCP 不可用时回退到 `<lodge-tool>{"name":"...","args":{...}}</lodge-tool>` 文字协议。两条路径都不是新的 roleKind，也不改变谁有权放行。
- Planner MCP 生命周期：建房时注册并启用，Planner bot 的 `mcpServers` 只多这一项；房间 `signed`/`rejected` 时移除；`stopped` 房间超过 TTL（默认 10 分钟）后由定时 sweep 回收；正在执行工具调用的房间不中断。启动时先 sweep 再补齐进行中房间。基座最多保存 20 个 MCP server，`/api/health` 暴露 `plannerMcp` 数量与在途调用数。

## 公共约束

1. 角色实例绑定房间，身份不跨房间继承。
2. 证据契约统一：Executor 交付核心为结构化证据包；Verifier 判定只采信证据包，不采信执行者自述结论。
3. 跨范式迁移：聊天室只提供结构化摘要导出（`GET /api/rooms/:id/snapshot`：目标、轮次、结论、讨论记录），供人复制到新建工作室；系统不提供“快照导入新工作室”API，不原地变更房型。结论确认后可在结论卡直接打开“新建工作室”，只预填目标与结论文本，不复制聊天记录、证据、阶段或状态。
4. `closure` 是工作室专属字段；聊天室不存在 `closure`，任何代码不得在聊天室里读取或推断交付闭环状态。
5. `swarm` 只是 Verifier 的调度策略，不新增 `roleKind`，也不产生独立评审原语。
6. 两套房型的能力开关由 `server/crew/room-capabilities.js` 提供；代码不得在各处重新散落房型能力判断。Gate 实现在 `server/crew/room-gate.js`。
7. 信任阶梯 `trust` 只属于工作室；聊天室席位是 `participant`，没有 `trust` 字段，也不提供信任升级动作。
8. advisor 是外部建议端口（`server/crew/advisor.js`，配置与契约见 `docs/advisor.md`）：Gate 和 Verifier 可附上建议，但 advisor 不写 verdict、不是 roleKind、不可直接放行。

## 负面清单（硬禁止）

这些不是“暂时没做”，而是越界后会让两套引擎重新糊在一起：

1. **不新增第四种 `roleKind`**。新岗位只能用 `roleProfile` 包装；`planner / executor / verifier` 是底层枚举。
2. **聊天室不引入 `stages / gates / closure / evidence / verdict / trust`**。聊天室只有 `room.chat`。
3. **工作室不引入 `room.chat`**。工作室只用 `closure / stages / evidence / verdict / trust`。
4. **房型创建后不动态切换**。需要交付就新建工作室，不把聊天室原地改成工作室。
5. **不让 Verifier 缺席时标记完成**。人工签字也必须先有 Verifier PASS；`rejected` 不是完成。
6. **评估建议不写 `pass`、不直接放行、不成为角色**。它只返回 advice。
7. **聊天室不挂完整执行引擎**。写文件、执行命令、外部动作都不放行；要执行请新建工作室。
8. **角色实例不跨房间继承**。身份绑定房间。
9. **不做快照自动导入新工作室**。只导出结构化摘要，由人复制到新建工作室；不提供导入 API。
10. **子工作室最多 3 层，且子工作室不能是聊天室**。父 Planner 只消费子 Verifier 的 verdict。
11. **影子评审不能替代正式 Verifier**。影子 verdict/score 只能记录，不能进入 `signed` 门禁，也不注入 Verifier prompt。
12. **advisor 不输出 `pass` / `reject` verdict**。它只返回建议；正式判定只能来自 Verifier 或人工签字。
13. **子工作室不能直接修改父工作室的 `closure`**。父房只能读取子房的 verdict，并由自己的 Planner/Verifier 继续流转。

## 暂不做（可重新评估）

这些不是永久禁止，只是当前明确的非目标：

- 外部评估产品接入（本地已有规则/模型评估服务，外部地址由 `ADVISOR_URL` 指定）
- 子工作室 UI 编排

## 对应门禁

- `server/crew/negative-list.test.js`：聊天室/工作室状态、advisor 建议、快照导入方向的静态检查。
- `server/crew/boundary.test.js`：crew 不泄漏基座词汇。
- `server/crew/layer-boundaries.test.js`：应用层只依赖端口。
- `server/crew/room-types.test.js` / `verifiers.test.js`：三类本原角色与 quorum 行为。
- `server/crew/room-capabilities.test.js`：两套房型的能力矩阵。
