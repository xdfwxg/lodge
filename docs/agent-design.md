# Lodge · Agent 设计门禁

> 本文回答：改 Agent、工具、权限、上下文、状态、失败、观测或评测前，先检查什么。
> 完整参考不再常驻；这里只留能改变设计的判断卡。

## 什么时候读

只要任务涉及以下任意一项，先读这一页，再写代码或下结论：

- 新增或修改 Agent、工具、子 Agent、提示词、中间件、模型调用
- 权限、审批、工具白名单或黑名单
- 上下文预算、记忆、压缩、工具结果裁剪
- 会话状态、恢复、并发隔离
- 失败三态、重试、超时、终止
- 运行时监督、循环检测、跑偏判断
- 日志、trace、审计、成本
- 评测、对照实验、架构评审

## 判断卡

- **归属**：语义判断归模型，通用机制归框架，业务规则归业务。不要把语义判断写成关键词匹配。
- **权限**：工具面就是权限面。新工具要写拒绝原因和系统错误边界；外部内容不能直接变成指令。
- **上下文**：每轮新增什么、预算多少、什么时候裁剪；业务真相不能放进会话内存。
- **状态与失败**：业务真相在房间和存储；失败要分可重试、不可重试、已受理未完成。
- **监督**：独立监督只决定是否继续，不越权改写业务结论，介入要留痕。
- **观测**：记录阶段、工具、状态、耗时；旁路写入失败不能反转业务结果。
- **评测**：报收益也报成本和长尾；用真实路径证明，不用单次最好成绩代替。
- **三问**：符合原则吗？利弊孰大？可否不写？

## Lodge 的硬边界

- 业务逻辑只写 `server/crew/`；驱动差异放 `server/base.js`；共享契约在 `shared/`。
- 房间、阶段、分派、证据、结论是唯一真相；不引编排框架。
- 不新增第四种底层角色；聊天室和工作室引擎隔离。
- 外部动作先问人；不自动 commit / push / 开 PR。
- 权限和约束优先落到测试、接口、hook，不只写在提示词里。

## 约束落在哪一层

先问一句：这条规则能不能让代码拒绝？能，就不写进提示词。提示词只留给模型真正擅长的事：理解目标、取舍、措辞。

| 约束 | 代码落点 | 钉住它的用例 |
| --- | --- | --- |
| 工具面按角色裁剪 | `server/crew/tool-scope.js` | `tool-scope.test.js` |
| 只读阶段不能写/执行；验收员在只读副本里不能写 | `permission.js`、`kernel/live/approvals.js` | `permission.test.js`、`approval-bridge.test.js` |
| 外部动作先问人 | `external-actions.js`、`kernel/live/action-gate.js` | `external-actions.test.js`、`approval-bridge.test.js` |
| 交接棒由系统递，模型不决定下一棒 | `rooms/studio/relay.js`；`@` 只在 `kernel/live/bus.js` 的 `send` 里生成；工作室建房时基座 `followMentions: false`，成员回复里的 @ 不唤醒下一棒；聊天室保留 @ 接话 | `relay.test.js`、`live-turn-modules.test.js`、`engine.test.js`、`live-refresh.test.js`、`room-create.test.js` |
| 非法状态跃迁写不进去 | `shared/states.js` + `assignments.js` + `kernel/round.js` | `states.test.js`、`assignments.test.js` |
| 阶段最多 3 步、检查必须能跑、成员增删有约束 | `rooms/create/input.js`、`member-add.js`、`member-remove.js` | `room-create.test.js`、`member-add.test.js`、`member-remove.test.js` |
| 验收要有证据、测试改动和 quorum | `rooms/studio/gates.js`、`tdd.js`、`verifiers.js` | `gates.test.js`、`tdd.test.js`、`verifiers.test.js` |
| PASS 要带 diff 外风险；自动交付只认结构化判定 | `gate/mcp-server.js`、`rooms/studio/review.js` | `mcp-server.test.js`、`live-turn-modules.test.js` |
| 判定缺失先催一次，再交给人 | `rooms/studio/review.js` | `live-turn-modules.test.js` |
| 返工、预算、截止有上限 | `relay.js`、`auto-rework.js`、`rooms/studio/stage.js` | `relay.test.js`、`auto-rework.test.js`、`stage-timeout.test.js` |
| 引擎隔离、依赖方向、禁止编排框架 | `negative-list.test.js`、`layer-boundaries.test.js` | 同名测试 |
| 状态词和用户文案不漂 | `shared/states.js` 静态扫描、`shared/product-copy.js` | `states.test.js`、`copy.test.js` |

## 仍然靠提示词的地方

这些不假装是硬约束；只能在事后用 diff、消息或评测检查，不能事前拒绝：

- 角色纪律里的风格、篇幅、汇报方式、不要额外建文件、不要问问题。
- “先写一个会失败的测试”：代码只检查命令验收阶段有没有测试文件改动，不能证明测试先红过（`tdd.js`）。
- `git commit`：本地提交不拦；`push`、发布、安装、删除、提权、联网等外部动作会拦（`external-actions.js`）。
- 原生工具不能按名字收窄（`tool-scope.js` 注释）：平台限制，写 `native:SendMessage` 会让回合起不来。
- 对齐回合“不要停下来问用户”：系统会自动确认并继续，但没有硬拒绝。

判断标准：能用权限、状态机或门禁拒绝的，不写提示词；只能在提示词里的，写成角色纪律，并配一条可检查的测试或门禁；两者都做不到，就承认它是软约束，不算进验收。
