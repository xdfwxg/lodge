# Lodge 房间模型：ChatRoom / WorkRoom

> 目标架构。当前实现状态以 `docs/reuse-map.md` §8.5 为准；本文只定义不可随意突破的边界。

Lodge 底层将房间划分为两类，房间类型创建时确定，运行期不可切换，绑定两套独立引擎：

- `chat`：对话引擎
- `studio`：交付引擎

核心原则：严格区分「对话共识范式」与「可验收交付范式」，两套状态机、数据结构、能力体系完全隔离；工作室所有业务岗位基于 3 种本原角色派生，不新增底层角色原语。

## 1. ChatRoom 聊天室

- 引擎：`chat` 对话引擎
- 底层角色原语：仅 `participant`；主持人通过布尔标记 `isHost: true` 区分，不复用 planner 语义
- 独立状态：`room.chat`，自有字段：`round`、`phase: discussing | summarizing | awaiting_decision`、`turns`、`conclusionId`、`accepted`
- 边界约束：**不使用工作室的 closure / stages / gates / evidence / verdict 体系**。聊天室的结论确认只是对话规则收尾，不属于交付门禁、不进入信任阶梯。
- 能力：自由讨论、圆桌对齐、头脑风暴；仅开放低风险只读工具，不挂载 Pi 完整执行引擎。
- 无 Gate 前置管道，无开工卡，无强制验收闭环。

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
- 内置底座：开工卡状态机、审批卡、权限卡、信任阶梯 `trust.js`、证据持久化、loop 迭代闭环。验收按阶段幂等：执行者没有工具调用或产出的闲聊回合不触发新的命令验收；没有新增交付改动时沿用已完成的验收，不重复提交候选。
- 流转公约：主任务闭环必须经过 Planner → Executor → Verifier；支持子任务并行、重试、分支，但进入执行阶段后不可绕过 Verifier 放行。
- 子工作室：最多 3 层，子房必须是 studio；父 Planner 只接收子工作室 Verifier 的 verdict，不重审子房证据细节。子房完成后会以 `child_result` 消息回到父房，并唤醒父 Planner。
- 影子评审 `shadowReview`：只记录 advisor/影子评估的 score 和 advice，不拦截、不产生正式 verdict；正式 Verifier 仍然必须 PASS 才能 signed。
- Planner 工具面：Lodge 自带一个按房间注册的无状态 MCP server（`/mcp/planner/<roomId>`，令牌绑定房间），只挂给该房间的 Planner，提供 `create_subroom`、`reject_plan`、`check_gate`；工具调用回到业务层执行，结果由 MCP 返回，Planner 不能伪造。MCP 不可用时回退到 `<lodge-tool>{"name":"...","args":{...}}</lodge-tool>` 文字协议。两条路径都不是新的 roleKind，也不改变谁有权放行。
- Planner MCP 生命周期：建房时注册并启用，Planner bot 的 `mcpServers` 只多这一项；房间 `signed`/`rejected` 时移除，启动时清理没有进行中房间的条目。基座最多保存 20 个 MCP server。

## 公共约束

1. 角色实例绑定房间，身份不跨房间继承。
2. 证据契约统一：Executor 交付核心为结构化证据包；Verifier 判定只采信证据包，不采信执行者自述结论。
3. 跨范式迁移：聊天室只提供只读快照导出（`GET /api/rooms/:id/snapshot`），不提供“快照导入新工作室”；需要交付时由人新建工作室，不原地变更房型。
4. `closure` 是工作室专属字段；聊天室不存在 `closure`，任何代码不得在聊天室里读取或推断交付闭环状态。
5. `swarm` 只是 Verifier 的调度策略，不新增 `roleKind`，也不产生独立评审原语。
6. 两套房型的能力开关由 `server/crew/room-capabilities.js` 提供；代码不得在各处重新散落房型能力判断。Gate 实现在 `server/crew/room-gate.js`，房间预设在 `server/crew/room-templates.js`；自定义房间模板存 `<dataDir>/room-templates/*.json`，通过 `/api/room-templates` 保存/删除。
7. advisor 是外部建议端口（`server/crew/advisor.js`，配置与契约见 `docs/advisor.md`）：Gate 和 Verifier 可附上建议，但 advisor 不写 verdict、不是 roleKind、不可直接放行。

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
9. **不做快照自动导入新工作室**。只导出只读快照，由人另建工作室。
10. **子工作室最多 3 层，且子工作室不能是聊天室**。父 Planner 只消费子 Verifier 的 verdict。
11. **影子评审不能替代正式 Verifier**。影子 verdict/score 只能记录，不能进入 `signed` 门禁。

## 暂不做（可重新评估）

这些不是永久禁止，只是当前明确的非目标：

- 模板“保存当前配置为模板”按钮
- 外部评估产品接入（本地已有规则/模型评估服务，外部地址由 `ADVISOR_URL` 指定）
- 子工作室 UI 编排

## 对应门禁

- `server/crew/negative-list.test.js`：聊天室/工作室状态、advisor 建议、快照导入方向的静态检查。
- `server/crew/boundary.test.js`：crew 不泄漏基座词汇。
- `server/crew/layer-boundaries.test.js`：应用层只依赖端口。
- `server/crew/room-types.test.js` / `verifiers.test.js`：三类本原角色与 quorum 行为。
- `server/crew/room-capabilities.test.js`：两套房型的能力矩阵。
