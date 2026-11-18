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
| 判定契约（首行结论 + JSON 明细） | `shared/judgment.test.js`、`server/crew/live-turn-modules.test.js`、`ui/src/room/studio/message-view.test.js` | 无 |
| 判定工具（MCP gate） | `shared/gate.test.js`、`server/crew/gate/mcp-server.test.js`、`server/crew/gate/tool.test.js`、`server/crew/live-turn-modules.test.js`、`server/crew/engine.test.js`、`server/crew/permission.test.js`、`server/crew/external-actions.test.js` | 真实基座可选 |
| 卡片有效期（阶段 + 重做轮次 + assignment） | `shared/attempt.test.js`、`server/crew/assignments.test.js`、`server/crew/attention.test.js`、`server/crew/approval-bridge.test.js`、`ui/src/room/question-card.test.js` | 无 |
| 人工门动作集 | `shared/human-gate.test.js`、`ui/src/room/studio/stage-gate.test.js` | 无 |
| 运行租约 / 并行分支重试 | `server/crew/assignments.test.js`、`server/crew/service-stages.test.js` | 无 |
| 任意步骤退回（含 decision） | `server/crew/service-stages.test.js`、`ui/src/room/studio/rewind-dialog.test.js` | 无 |
| 原生换身体（保留线程） | `server/crew/kernel/live/body-swap.test.js`、`server/crew/engine.test.js` | 真实基座可选 |
| 聊天室↔工作室模式切换 | `server/crew/mode-switch.test.js` | 真实基座可选 |
| 角色定义（定义 / 实例分层） | `shared/role-definitions.test.js`、`server/crew/roster.test.js` | 无 |
| 退回指定步骤、补上下文再跑 | `server/crew/service-stages.test.js`、`ui/src/room/studio/rewind-dialog.test.js` | 无 |
| 并行执行、合并冲突、超时 | `server/crew/live-turn-modules.test.js`、`server/crew/rooms/studio/stage-timeout.test.js`、`server/crew/rooms/studio/auto-rework.test.js` | 无 |
| 子房间创建与结果回填 | `server/crew/room-subrooms.test.js`、`server/crew/service-subrooms.test.js`、`server/crew/service-subrooms-notify.test.js` | 无 |
| 外部动作审批、叫停、排队 | `server/crew/approval-bridge.test.js`、`server/crew/live-approvals.test.js`、`server/crew/external-actions.test.js`、`server/crew/member-delivery.test.js` | 真实 git push 需 dogfood |
| 归档、恢复、删除、改名 | `server/crew/service-lifecycle.test.js`、`server/crew/workspace-git.test.js`、`server/crew/rooms/base/retire.test.js` | 无 |
| 交付记录与交付卡 | `server/crew/delivery.test.js`、`ui/src/room/studio/delivery-record.test.js`、`ui/src/room/studio/delivery-card.test.js` | 无 |
| 重启恢复、断线重连 | `server/crew/recovery.test.js`、`server/crew/live-sync.test.js`、`ui/src/store.test.js` | 无 |
| API 路由与动作清单 | `server/route-table.test.js`、`server/crew/route-sweep.test.js` | 无 |
| 驱动边界、运行端口、分层 | `server/crew/engine.test.js`、`server/crew/runtime-port.test.js`、`server/crew/layer-boundaries.test.js`、`server/crew/boundary.test.js` | 真实基座可选 |
| 基座旧房间回收（gc:base） | `server/base-gc.test.js`、`server/crew/base-error.test.js` | 真实基座可选 |
| 成员身体与换模型 | `server/crew/body-change.test.js`、`server/crew/body-check.test.js`、`server/crew/body-spec.test.js` | 无 |
| 界面阶段门与结论卡 | `ui/src/room/studio/stage-gate.test.js`、`ui/src/room/studio/message-view.test.js`、`ui/src/room/studio/transcript-model.test.js` | 无 |

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
