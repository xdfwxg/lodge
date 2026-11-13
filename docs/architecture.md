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
  - `verifier`：独立鉴证，对照证据包与验收标准产出 verdict；Jev 仅提供辅助打分建议，不具备最终决策权
- `roleProfile`：上层业务标签（gate-coordinator、architect、qa-reviewer、retro-analyst 等），仅用于 UI、提示词、playbook，不影响底层权限与流转。
- 前置管道 Gate：独立于三类本原角色，在 Planner 启动规划前运行；输入目标，输出 allow / reject、理由、Jev 建议；Gate 只控制准入，不拆解任务、不写方案。
- 工作室流转 `closure` 状态：`open | planned | executing | verifying | signed | rejected`
  - `rejected`：仅 Planner 在 `planned` 阶段可触发，附带理由与证据；属于合法终态，**标记为不可行，不等于任务完成**
  - 一旦进入 `executing`：所有驳回、通过判定权限收归 Verifier，Planner 不能单方面终止或放行
  - 验收模式 `verificationMode: bot | human | hybrid`：人工验收不旁路，人工评审同样产出标准 verdict 记录；`swarm` 是 Verifier 多实例投票策略，属于 playbook 层调度，不是新增底层角色
- 内置底座：开工卡状态机、审批卡、权限卡、信任阶梯 `trust.js`、证据持久化、loop 迭代闭环
- 流转公约：主任务闭环必须经过 Planner → Executor → Verifier；支持子任务并行、重试、分支，但进入执行阶段后不可绕过 Verifier 放行。

## 公共约束

1. 角色实例绑定房间，身份不跨房间继承。
2. 证据契约统一：Executor 交付核心为结构化证据包；Verifier 判定只采信证据包，不采信执行者自述结论。
3. 跨范式迁移：聊天室只提供只读快照导出（`GET /api/rooms/:id/snapshot`），不提供“快照导入新工作室”；需要交付时由人新建工作室，不原地变更房型。
4. `closure` 是工作室专属字段；聊天室不存在 `closure`，任何代码不得在聊天室里读取或推断交付闭环状态。
5. `swarm` 只是 Verifier 的调度策略，不新增 `roleKind`，也不产生独立评审原语。
6. 两套房型的能力开关由 `server/crew/room-capabilities.js` 提供；代码不得在各处重新散落房型能力判断。Gate 实现在 `server/crew/room-gate.js`，房间预设在 `server/crew/room-templates.js`。
