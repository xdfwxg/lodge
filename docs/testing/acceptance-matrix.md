# 验收矩阵

这张表回答一件事：每个用户能力由哪条自动用例保护，跑它需要什么。它只列仓库里真实存在的用例；没有自动覆盖的能力放在最后，写清楚为什么。

## 怎么跑

```bash
npm test                 # 服务端、共享契约和 UI 单元测试
npm run test:e2e         # 房间端到端
npm run check:regressions
npm run check:acceptance # 检查这张表引用的用例都还在
```

## 覆盖表

| 能力 | 自动用例 | 需要 |
| --- | --- | --- |
| 建房、成员组合、roster 推荐 | `server/crew/room-create.test.js`、`server/crew/roster.test.js`、`server/crew/member-add.test.js`、`server/crew/member-remove.test.js` | 无 |
| 聊天室主持、@、轮次、结论 | `server/crew/live-chat.test.js`、`server/crew/live-chat-room.test.js`、`server/crew/service-chat.test.js`、`server/crew/live-turns.test.js` | 真实模型仅整房 dogfood |
| 聊天室灵动岛（与工作室同一目标岛） | `ui/src/room/chat/island.test.js`、`ui/src/room/chat/view.test.js` | 无 |
| 工作室阶段、验收、签字、重做 | `server/crew/service-stages.test.js`、`server/crew/gates.test.js`、`server/crew/verifiers.test.js`、`server/crew/e2e-room.test.js` | 无 |
| 长期工作室、轮次隔离、旧轮只读、项目分组 | `server/crew/store-rounds.test.js`、`ui/src/views/project-view.test.js`、`e2e/project.spec.mjs` | 无 |
| 轮次开始、完成、停止、退回、失败、作废 | `server/crew/kernel/round.test.js`、`server/crew/rounds/lifecycle.test.js`、`server/crew/store-rounds.test.js` | 无 |
| 房间状态与轮次状态分开说 | `shared/room-status.test.js`、`ui/src/goal-island/status.test.js`、`ui/src/views/sidebar.test.js` | 无 |
| 持久队列、租约回收、重试退避 | `server/crew/rooms/scheduler.test.js`、`server/crew/store-rounds.test.js` | 无 |
| 阶段截止进持久队列，重启仍会到点 | `server/crew/rooms/studio/stage-timeout.test.js`、`server/crew/rooms/scheduler.test.js` | 无 |
| 聊天室一轮占持久工作项，重启从已发言次数续跑 | `server/crew/live-chat-room.test.js`、`server/crew/rooms/chat/runtime.test.js` | 真实模型仅整房 dogfood |
| 聊天重启补账：回复已到但 turns 未落库，不重说 | `server/crew/live-chat-room.test.js` | 无 |
| 交接级租约只停一个成员，阶段截止仍是兜底 | `server/crew/rooms/studio/stage-timeout.test.js` | 无 |
| 工作室默认接力：退回直接回执行官，通过回规划师 | `server/crew/rooms/studio/relay.test.js`、`server/crew/live-turn-modules.test.js` | 无 |
| 接力投递不依赖模型写 @：派发、复核、退回都由系统投递并发群聊投影 | `server/crew/live-turn-modules.test.js`、`server/crew/prompt-modes.test.js` | 真实房间复查 |
| 中间步骤验收通过自动过并开始下一步，最后一步仍由人确认 | `server/crew/live-turn-modules.test.js`、`server/crew/service-stages.test.js` | 无 |
| 重置前归档工作区，数据库与工作区成对恢复 | `server/crew/data-recovery.test.js` | 无 |
| 跨轮长期任务：重启、停止、归档、预算、人工门 | `server/crew/long-task-recovery.test.js`、`evals/long-task/run.mjs` | 确定性场景，不调模型 |
| 房间写与轮次写分开，终态轮拒绝写入 | `server/crew/store-rounds.test.js`、`server/crew/store.test.js` | 无 |
| HTTP 动作按族分派，暂停门禁只拦轮次动作 | `server/crew/route-sweep.test.js`、`server/http-coverage.test.js` | 无 |
| 轮次预算在派发前拦住 | `shared/usage.test.js`、`server/crew/rooms/studio/auto-rework.test.js` | 无 |
| 判定契约（首行结论 + JSON 明细） | `shared/judgment.test.js`、`server/crew/live-turn-modules.test.js`、`ui/src/room/studio/message-view.test.js` | 无 |
| 判定提交强制（先催一次，再交给人） | `shared/judgment.test.js`、`server/crew/live-turn-modules.test.js` | 无 |
| 验收按目标原文判断（不替换成更弱标准） | `server/crew/live-turn-modules.test.js` | 真实模型可选 |
| 返工预算耗尽转人 | `server/crew/live-turn-modules.test.js` | 无 |
| 晚到回合围栏（旧尝试不污染新结果） | `server/crew/live-turn-modules.test.js`、`server/crew/engine.test.js` | 无 |
| 人的输入落成证据 | `server/crew/service-stages.test.js`、`server/crew/live-approvals.test.js` | 无 |
| 交给人后的输入回路 | `server/crew/rooms/studio/human-handoff.test.js`、`server/crew/live-turn-modules.test.js` | 真实模型可选 |
| 成本状态（已报告 / 部分未知 / 未知） | `shared/usage.test.js`、`server/crew/delivery.test.js`、`server/crew/rooms/chat/runtime.test.js`、`ui/src/room/studio/delivery-card.test.js` | 无 |
| 执行诊断包 | `server/crew/room-repo.test.js`、`server/crew/live-turn-modules.test.js`、`server/crew/turn-assessment.test.js` | 无 |
| 并行分支复活（重试一个分支带回兄弟） | `server/crew/live-turn-modules.test.js` | 无 |
| 重启续接规则（动过工具只续接，零产出只重开一次） | `server/crew/live-turn-modules.test.js` | 无 |
| HTTP 成功覆盖（只认 2xx/3xx） | `server/http-coverage.test.js` | 无 |
| HTTP 错误分类与附加字段 | `server/http-coverage.test.js` | 无 |
| 成员工具面裁剪（隐藏协调与判定工具） | `server/crew/tool-scope.test.js`、`server/crew/engine.test.js` | 真实基座可选 |
| 不可信内容清洗与字符预算 | `shared/untrusted-text.test.js` | 无 |
| 房间记忆（审核后只读引用、删除、停用） | `server/crew/memory.test.js`、`server/crew/service-composition.test.js`、`server/crew/prompt-order.test.js`、`server/http-coverage.test.js` | 真实交付可选 |
| 工作区记忆入口（建房时按文件夹出现） | `server/crew/memory.test.js`、`server/http-coverage.test.js` | 真实文件夹需 dogfood |
| 房间记忆备份与恢复边界 | `server/crew/data-recovery.test.js` | 无 |
| 房间健康卡（证据 / 未知 / 下一步、费用、返工） | `ui/src/room/health.test.js`、`server/crew/turn-assessment.test.js` | 无 |
| 新房间入口与房型选择 | `ui/src/new-room-dialog.test.js` | 无 |
| 房间列表顺序（待办在前、归档在后） | `ui/src/views/sidebar.test.js` | 无 |
| 人工门没有死路（交给人后可见输入动作） | `ui/src/room/studio/human-gate.test.js`、`server/crew/rooms/studio/human-handoff.test.js` | 无 |
| 提示词与工具面的确定性顺序 | `server/crew/prompt-order.test.js`、`server/crew/tool-scope.test.js` | 无 |
| 判定工具（MCP gate） | `shared/gate.test.js`、`server/crew/gate/mcp-server.test.js`、`server/crew/gate/tool.test.js`、`server/crew/live-turn-modules.test.js`、`server/crew/engine.test.js`、`server/crew/permission.test.js`、`server/crew/external-actions.test.js` | 真实基座可选 |
| 卡片有效期（阶段 + 重做轮次 + assignment） | `shared/attempt.test.js`、`server/crew/assignments.test.js`、`server/crew/attention.test.js`、`server/crew/approval-bridge.test.js`、`ui/src/room/question-card.test.js` | 无 |
| 人工门动作集 | `shared/human-gate.test.js` | 无 |
| 运行租约 / 并行分支重试 | `server/crew/assignments.test.js`、`server/crew/service-stages.test.js` | 无 |
| 任意步骤退回（含 decision） | `server/crew/service-stages.test.js`、`shared/gate.test.js`、`server/crew/gate/mcp-server.test.js` | 真实模型需 dogfood |
| 原生换身体（保留线程） | `server/crew/kernel/live/body-swap.test.js`、`server/crew/engine.test.js` | 真实基座可选 |
| 角色定义（定义 / 实例分层） | `shared/role-definitions.test.js`、`server/crew/roster.test.js` | 无 |
| 退回指定步骤、补上下文再跑 | `server/crew/service-stages.test.js`、`shared/gate.test.js` | 真实模型需 dogfood |
| 并行执行、合并冲突、超时 | `server/crew/live-turn-modules.test.js`、`server/crew/workspace-git.test.js`、`server/crew/service-merge.test.js`、`server/crew/rooms/studio/stage-timeout.test.js`、`server/crew/rooms/studio/auto-rework.test.js`、`ui/src/room/studio/merge-conflict.test.js` | 真实 git 冲突解决需 dogfood |
| 外部动作审批、叫停、排队 | `server/crew/approval-bridge.test.js`、`server/crew/live-approvals.test.js`、`server/crew/external-actions.test.js`、`server/crew/member-delivery.test.js`、`ui/src/room/studio/transcript.test.js` | 真实 git push 需 dogfood |
| 受控浏览器（chrome-devtools MCP） | `server/browser-mcp.test.js`、`server/crew/roster.test.js`、`server/crew/room-access.test.js`、`shared/room-access.test.js`、`server/crew/approval-bridge.test.js`、`ui/src/room/studio/create.test.js`、`ui/src/approval-card.test.js` | 真实 Chrome |
| 运行中的工具动效（折叠命令、时长、动效） | `ui/src/room/studio/working-line.test.js` | 无 |
| 归档、恢复、删除、改名 | `server/crew/service-lifecycle.test.js`、`server/crew/workspace-git.test.js`、`server/crew/rooms/base/retire.test.js` | 无 |
| 交付记录、结果优先的交付页 | `server/crew/delivery.test.js`、`ui/src/room/studio/delivery-record.test.js`、`ui/src/room/studio/delivery-card.test.js`、`ui/src/room/studio/transcript.test.js` | 无 |
| 重启恢复、断线重连 | `server/crew/recovery.test.js`、`server/crew/live-sync.test.js`、`ui/src/store.test.js` | 无 |
| 暂停与成员出错后的一步修复 | `server/crew/live-sync.test.js`、`server/crew/kernel/live/body-swap.test.js`、`ui/src/room/decision.test.js`、`ui/src/room/paused-panel.test.js`、`ui/src/room/chat/view.test.js` | 无 |
| API 路由与动作清单 | `server/route-table.test.js`、`server/crew/route-sweep.test.js` | 无 |
| 驱动边界、运行端口、分层 | `server/crew/engine.test.js`、`server/crew/runtime-port.test.js`、`server/crew/layer-boundaries.test.js`、`server/crew/boundary.test.js` | 真实基座可选 |
| 基座旧房间回收（gc:base） | `server/base-gc.test.js`、`server/crew/base-error.test.js` | 真实基座可选 |
| 成员身体与换模型 | `server/crew/body-change.test.js`、`server/crew/body-check.test.js`、`server/crew/body-spec.test.js` | 无 |
| 界面阶段门与结论卡 | `ui/src/room/studio/message-view.test.js` | 无 |

## 没在自动覆盖里的

- 真实模型完成一整间房：靠人工 dogfood；模型输出不固定，不能当断言。
- 真实 `git push`、远端分支和 PR：需要外部仓库和凭据，靠 dogfood。
- 复核超时：定时是 10 分钟，单元级只覆盖判定逻辑，没有实跑完整超时。
- macOS 打包、ad-hoc 签名和桌面外壳：手工 smoke，不在单元测试里。
- 外部 MCP 市场、第三方工具和外部通知：没有接入，不做假覆盖。

真实跑过的路径和未触发项记在 [validation.md](validation.md)。

## 加一条能力时

1. 先写能复现用户路径的自动用例，放在最靠近业务的那一层。
2. 在覆盖表加一行，写清楚需要真实模型、真实基座还是外部服务。
3. 房间动作再加一条：只改 `server/route-table.js` 的动作清单，`route-sweep` 会自动检查处理器和 HTTP 路由。
4. 跑 `npm run check:acceptance`，确认表里引用的用例文件都还在。
