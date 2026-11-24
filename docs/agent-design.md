# Lodge · Agent 设计门禁

> 本文回答：改 Agent、工具、权限、上下文、状态、失败、观测或评测前，先检查什么。
> 通用判断见 [思想.md](../思想.md)；这里只留能改变设计的判断卡。

> 边界现状：目标是写边界可证明——房间里只能写自己的工作树。成员的 shell 走 worktree 加审批，回合结束后对账并退回越界写入，还不是文件系统拒绝；验收员拿到只读副本，平台不再为验收起 OS 沙箱；家目录和房间外的路径没有 OS 级拦截。

## 分工落在哪

| 这句话 | 今天靠什么 | 还没有的 |
| --- | --- | --- |
| 语义交给模型 | 规划师提交方案与队伍、执行官拆实现、验收员做语义复核；提示词只写纪律 | 风格、篇幅这类仍是软约束 |
| 判定交给业务 | `gates.js`、`review.js`、完成态、预算、受保护文件、退回规则 | 验收员的 PASS/REJECT 仍是语义输入，业务只决定它算不算数 |
| 约束交给代码 | 工具面、权限、审批闸、状态机、worktree、验收沙箱；回合后对账，越界写入别人的工作树会被退回 | 家目录和房间外的绝对路径没有 OS 级拦截；Linux 的 bot box 可用，macOS 还没有 |
| 证据交给验收 | 平台收集的结果证据、验收员自验、门禁 | 验收员怎么验由它自己定，平台只能要求它写清实际验了什么 |
| 人只管不可逆和不可验证 | 外部动作审批、交付后的否决、交给人 | 人还要定产品方向，这属于不可验证那一类 |
| 下一步归系统 | 接力规则 `relay.js` 决定下一棒，模型不写 @ | 无 |

## 共同的和分开的

共同事实、独立判断和成员边界见 [思想.md 的「共同的和分开的」](../思想.md#共同的和分开的)；这里不重复。

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

底座原则见 [思想.md 的「Agent 系统底座」](../思想.md#agent-系统底座)；这里是动手前的检查卡。

- **分工**：事实全局唯一；判断独立形成，结论公开；系统掌管流转、门禁、红线；成员负责推理、立场、交付与争议。
- **流转**：规划师管内容（拆解、阶段、工作包、队伍、重做或停下），系统管流转（下一棒、叫醒、租约、预算、门禁、写边界、验收票数）；派活权不交给模型。
- **归属**：语义判断归模型，通用机制归框架，业务规则归业务。不要把语义判断写成关键词匹配。
- **权限**：工具面就是权限面。新工具要写拒绝原因和系统错误边界；外部内容不能直接变成指令。
- **验收**：规划师只写交付物，验收员自己定怎么验；PASS 看结果证据并逐条覆盖本步交付物，REJECT 必须指出一条会因它失败的检查（它自己跑的或目标行）；只有 minor 的问题不阻塞。证据是必要条件，不是充分条件；人只在交付后否决，不在中间点头。
- **上下文**：每轮新增什么、预算多少、什么时候裁剪；业务真相不能放进会话内存。
- **协议**：状态机记录，门禁拒绝；薄在不管模型怎么想，不在不做判定。
- **状态与失败**：业务真相在房间和存储；失败要分可重试、不可重试、已受理未完成。
- **监督**：独立监督只决定是否继续，不越权改写业务结论，介入要留痕。
- **观测**：记录阶段、工具、状态、耗时；旁路写入失败不能反转业务结果。
- **评测**：报收益也报成本和长尾；用真实路径证明，不用单次最好成绩代替；证据随模型能力升级，跑通不等于跑对。
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
| 交接棒由系统递，模型不决定下一棒 | 工作室由 `rooms/studio/relay.js` 决定，聊天室按公平顺序（每人先说一次，再立场互补，最后随机）；`@` 只在 `kernel/live/bus.js` 的 `send` 里生成；两种房间建房时基座 `followMentions: false` | `relay.test.js`、`live-turn-modules.test.js`、`live-chat-room.test.js`、`engine.test.js`、`room-create.test.js` |
| 非法状态跃迁写不进去 | `shared/states.js` + `assignments.js` + `kernel/round.js` | `states.test.js`、`assignments.test.js` |
| 阶段最多 3 步、每一步要有交付物、成员增删有约束 | `rooms/create/input.js`、`member-add.js`、`member-remove.js` | `room-create.test.js`、`member-add.test.js`、`member-remove.test.js` |
| 验收要有结果证据、覆盖表、亲手验过的工具痕迹和 quorum | `rooms/studio/gates.js`、`verifiers.js`、`coverage.js`、`verification-proof.js`、`runtime/result.js` | `gates.test.js`、`verifiers.test.js`、`coverage.test.js`、`verification-proof.test.js` |
| 高风险默认双厂商验收；误放率高的模型不进验收员池 | `rooms/studio/apply-plan.js`、`shared/verifier-pool.js` | `apply-plan.test.js`、`verifier-pool.test.js` |
| 退回必须挂到一条会失败的检查；没有 check 的 blocker/major 降为 minor | `shared/judgment.js`、`gate/mcp-server.js`、`review-prompts.js` | `judgment.test.js`、`mcp-server.test.js` |
| PASS 要带 diff 外风险；自动交付只认结构化判定 | `gate/mcp-server.js`、`rooms/studio/review.js` | `mcp-server.test.js`、`live-turn-modules.test.js` |
| 判定缺失先催一次，再交给人 | `rooms/studio/review.js` | `live-turn-modules.test.js` |
| 返工、预算、截止有上限 | `relay.js`、`auto-rework.js`、`rooms/studio/stage.js` | `relay.test.js`、`auto-rework.test.js`、`stage-timeout.test.js` |
| 引擎隔离、依赖方向、禁止编排框架 | `negative-list.test.js`、`layer-boundaries.test.js` | 同名测试 |
| 状态词和用户文案不漂 | `shared/states.js` 静态扫描、`shared/product-copy.js` | `states.test.js`、`copy.test.js` |

## 仍然靠提示词的地方

这些不假装是硬约束；只能在事后用 diff、消息或评测检查，不能事前拒绝：

- 角色纪律里的风格、篇幅、汇报方式、不要额外建文件、不要问问题。
- 验收员怎么验：平台只保证结果证据存在，不能证明它真的读了文件或跑了检查；`review-prompts.js` 要求它写清实际验了什么，判定仍可能走过场。
- `git commit`：本地提交不拦；`push`、发布、安装、删除、提权、联网等外部动作会拦（`external-actions.js`）。
- 原生工具不能按名字收窄（`tool-scope.js` 注释）：平台限制，写 `native:SendMessage` 会让回合起不来。
- 验收员走文本兜底时没有结构化 check：只有判定工具没挂上才会走；这时只能按首行和理由判断，不能要求 check。
- 对齐回合“不要停下来问用户”：系统会自动确认并继续，但没有硬拒绝。

判断标准：能用权限、状态机或门禁拒绝的，不写提示词；只能在提示词里的，写成角色纪律，并配一条可检查的测试或门禁；两者都做不到，就承认它是软约束，不算进验收。
