# 验收矩阵

这张表回答一件事：每个用户能力由哪条自动用例保护，跑它需要什么。它只列仓库里真实存在的用例；没有自动覆盖的能力放在最后，写清楚为什么。

## 怎么跑

```bash
npm test                 # 服务端、共享契约和 UI 单元测试
npm run test:e2e         # 房间端到端
npm run check:regressions
npm run check:acceptance # 检查这张表引用的用例都还在
npm run eval:verifier-probe -- --validate
npm run eval:planning-probe -- --validate
npm run eval:execution-probe -- --validate
```

## 覆盖表

| 能力 | 自动用例 | 需要 |
| --- | --- | --- |
| 建房、成员组合、roster 推荐 | `server/crew/room-create.test.js`、`server/crew/roster.test.js`、`server/crew/member-add.test.js`、`server/crew/member-remove.test.js` | 无 |
| 聊天室主持、公平顺序、轮次、自然总结/按需结构 | `server/crew/live-chat.test.js`、`server/crew/live-chat-room.test.js`、`server/crew/service-chat.test.js`、`server/crew/live-turns.test.js`、`shared/room-status.test.js` | 真实模型仅整房 dogfood |
| 聊天结论直接进工作室：共识、分歧、未定和下一步都进交接简报 | `server/crew/live-chat-room.test.js`、`shared/handoff-brief.test.js`、`ui/src/room-seeds.test.js` | 真实模型可选 |
| 聊天室灵动岛（与工作室同一目标岛） | `ui/src/room/chat/island.test.js`、`ui/src/room/chat/view.test.js` | 无 |
| 工作室阶段、验收、重做 | `server/crew/service-stages.test.js`、`server/crew/gates.test.js`、`server/crew/verifiers.test.js`、`server/crew/e2e-room.test.js` | 无 |
| 验收 PASS 逐条覆盖本步契约条款（最后一轮覆盖整轮），且本回合亲手读过文件或跑过检查 | `server/crew/rooms/studio/coverage.test.js`、`server/crew/rooms/studio/verification-proof.test.js`、`server/crew/live-turn-modules.test.js`、`server/crew/gate/mcp-server.test.js` | 无 |
| 契约是唯一真相：done 由 outcomes 派生，阶段必须引用已有 clause id，且每个 outcome 都分配 | `shared/crew-proposal.test.js`、`server/crew/rooms/create/input.test.js`、`server/crew/rooms/studio/coverage.test.js` | 无 |
| 交付自带可重跑的证明；验收员重跑同一条入口并补反例 | `server/crew/rooms/studio/proof-runner.test.js`、`server/crew/rooms/studio/review-prompts.test.js`、`server/crew/gates.test.js`、`server/crew/delivery.test.js` | 无 |
| 执行官只写自己的工作包：越界改动在 git 副本里退回并留证据 | `server/crew/rooms/studio/write-boundary.test.js`、`server/crew/workspace-guard.test.js` | 无 |
| 验收员 PASS 只能引用自己复核副本里的证据 | `server/crew/rooms/studio/read-boundary.test.js` | 无 |
| 验收模型按探针实测分池，误放率过高的模型被平台拒绝 | `shared/verifier-pool.test.js`、`server/crew/rooms/studio/apply-plan.test.js`、`evals/verifier-probe/run.mjs` | 真实模型（不进 `check:done`） |
| 规划师与执行官有真实模型探针，按模型记录成绩 | `evals/planning-probe/run.mjs`、`evals/execution-probe/run.mjs` | 真实模型（不进 `check:done`） |
| 规划师组队：执行官按工作包定数，验收员 1–3 位，平台校验模型/厂商/合并 | `shared/crew-proposal.test.js`、`server/crew/rooms/studio/apply-plan.test.js`、`server/crew/gate/mcp-server.test.js` | 无 |
| 投递失败重试沿用同一拍，不新建 Assignment | `server/crew/rooms/studio/handoff.test.js`、`server/crew/assignments.test.js`、`shared/states.test.js` | 无 |
| 退回必须挂到一条会失败的检查；只挑小毛病不阻塞 | `shared/gate.test.js`、`shared/judgment.test.js`、`server/crew/gate/mcp-server.test.js` | 无 |
| 成员回合后对账：写到别人工作树的改动被退回 | `server/crew/workspace-guard.test.js`、`server/crew/live-turn-modules.test.js` | 无 |
| 长期工作室、轮次隔离、旧轮只读、项目分组 | `server/crew/store-rounds.test.js`、`ui/src/views/project-view.test.js`、`e2e/project.spec.mjs` | 无 |
| 轮次开始、完成、停止、退回、失败、作废 | `server/crew/kernel/round.test.js`、`server/crew/rounds/lifecycle.test.js`、`server/crew/store-rounds.test.js` | 无 |
| 房间状态与轮次状态分开说 | `shared/room-status.test.js`、`ui/src/goal-island/status.test.js`、`ui/src/views/sidebar.test.js` | 无 |
| 持久队列、租约回收、重试退避、每房单活且房间间并发 | `server/crew/rooms/scheduler.test.js`、`server/crew/store-rounds.test.js` | 无 |
| 阶段截止进持久队列，重启仍会到点 | `server/crew/rooms/studio/stage-timeout.test.js`、`server/crew/rooms/scheduler.test.js` | 无 |
| 聊天室一轮占持久工作项，重启从已发言次数续跑 | `server/crew/live-chat-room.test.js`、`server/crew/rooms/chat/runtime.test.js` | 真实模型仅整房 dogfood |
| 聊天重启补账：回复已到但 turns 未落库，不重说 | `server/crew/live-chat-room.test.js` | 无 |
| 交接级租约只停一个成员，阶段截止仍是兜底 | `server/crew/rooms/studio/stage-timeout.test.js` | 无 |
| 工作室默认接力：退回直接回执行官，通过回规划师 | `server/crew/rooms/studio/relay.test.js`、`server/crew/live-turn-modules.test.js` | 无 |
| 接力投递不依赖模型写 @：派发、复核、退回都由系统投递并发群聊投影 | `server/crew/live-turn-modules.test.js`、`server/crew/prompt-modes.test.js` | 真实房间复查 |
| 验收通过即完成，中间步骤自动过、最后一步直接交付，不需要人确认 | `server/crew/live-turn-modules.test.js`、`server/crew/service-stages.test.js` | 无 |
| 高风险阶段默认两位不同厂商验收员；单厂商标模型自查 | `server/crew/rooms/studio/apply-plan.test.js`、`server/crew/fixtures/prompts/studio-alignment.txt` | 无 |
| 角色技能按角色取长、总量有体积预算，合并掉的旧技能不再挂载 | `shared/role-toolbox.test.js`、`server/skill-packs.test.js` | 真实房间读技能效果 |
| 状态目录完整，轮次事件可只读重放 | `shared/states.test.js`、`server/crew/rounds/replay.test.js` | 真实房间跑一次 `replay:round` |
| 聊天轮次可只读重放：谁说了什么、结论从哪来、缺口只报不补 | `server/crew/rounds/replay-chat.test.js` | 真实聊天室跑一次 `replay:chat` |
| 聊天上下文分层：上一轮结论共享、上一位原话进本轮、成员只带说话习惯 | `server/crew/rooms/chat/brief.test.js`、`server/crew/rooms/chat/speaker-prompt.test.js`、`server/crew/rooms/chat/kind.test.js`、`server/crew/room-create.test.js` | 真实聊天室读一轮发言 |
| 发言行显示两字立场；建房可填说话习惯；不改工具面 | `ui/src/room/chat/create.test.js`、`ui/src/room/message-view.test.js`、`ui/src/room/member-engine-picker.test.js`、`e2e/product.spec.mjs` | 真实聊天室读一轮发言 |
| 自动交付默认关；打开后最后一步验收通过自动收口 | `server/crew/live-turn-modules.test.js`、`ui/src/room/studio/create.test.js` | 真实房间打开开关跑一轮 |
| 成员回复里的 @ 不唤醒下一棒；聊天室公平顺序、每人先说到一次 | `server/crew/engine.test.js`、`server/crew/room-create.test.js`、`server/crew/live-chat-room.test.js` | 基座 `server/room-roots.e2e.test.ts` 覆盖真实路由 |
| 用户点名路由（结构化成员 id；`@所有人` 开一轮；直接问标记；主持不自行开轮；轮次中直接点名被拒） | `server/crew/service-chat.test.js`、`server/crew/rooms/chat/host-intent.test.js`、`server/crew/live-echo.test.js`、`ui/src/room/message-view.test.js` | 无 |
| 聊天开轮前检查预算 | `server/crew/service-chat.test.js` | 无 |
| 中期事件按房型处理：聊天主持/直接、工作室排队/叫停、交给人后重做 | `server/crew/service-chat.test.js`、`server/crew/rooms/studio/message.test.js`、`server/crew/live-chat-room.test.js`、`server/crew/live-turn-modules.test.js`、`server/crew/live-sync.test.js` | 真实房间可选 |
| 秘密不进日志、提示词、证据和记忆；验收员看不到 `.env` | `shared/secrets.test.js`、`shared/untrusted-text.test.js`、`server/crew/memory.test.js`、`server/crew/workspace-plain.test.js`、`server/crew/workspace-git.test.js`、`server/crew/workspace-direct.test.js`、`server/crew/negative-list.test.js` | 无 |
| 通知只给真正等人处理的事，同房有冷却 | `shared/quiet.test.js`、`ui/src/app/use-attention.js` | 无 |
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
| 一次运行的费用、重做、介入和记忆计数 | `ui/src/room/run-metrics.test.js`、`server/crew/turn-assessment.test.js` | 无 |
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
| 交付阶段盲评、证据先行、目标外重构不作为退回理由 | `server/crew/live-turn-modules.test.js` | 真实模型看提示词效果 |
| 受保护文件与既有测试改动必须逐条确认 | `server/crew/protected-files.test.js`、`shared/judgment-protected.test.js`、`server/crew/live-turn-modules.test.js` | 无 |
| 审批卡先说目标和后果，命令折叠，不建议时安全动作是主按钮 | `ui/src/approval-card.test.js`、`server/crew/external-actions.test.js`、`ui/src/room/studio/transcript.test.js` | 真实审批需 dogfood |
| 工作室的用户消息直达规划师，不靠群 @ 唤醒 | `server/crew/actions/room/decision.test.js` | 真实房间复查 |
| 长任务活状态行：谁、第几步、在跑什么、多久；未结束交接可停 | `ui/src/room/studio/typing.test.js`、`ui/src/room/stop-reply.test.js`、`ui/src/room/studio/transcript.test.js`、`server/crew/live-projection.test.js`、`server/crew/engine.test.js` | 真实长命令需 dogfood |
| 房间历史全文检索、只读简报和命中留痕 | `server/crew/store.test.js`、`server/crew/message-search.test.js`、`server/crew/rooms/studio/history-brief.test.js` | 真实长房间需 dogfood |
| 受控浏览器（chrome-devtools MCP） | `server/browser-mcp.test.js`、`server/crew/roster.test.js`、`server/crew/room-access.test.js`、`shared/room-access.test.js`、`server/crew/approval-bridge.test.js`、`ui/src/room/studio/create.test.js`、`ui/src/approval-card.test.js` | 真实 Chrome |
| 时间线里的过程摘要：中文动作、按位置收起、活状态与时长 | `ui/src/room/studio/transcript.test.js`、`ui/src/room/studio/typing.test.js`、`ui/src/room/run-metrics.test.js` | 无 |
| 归档、恢复、删除、改名 | `server/crew/service-lifecycle.test.js`、`server/crew/workspace-git.test.js`、`server/crew/rooms/base/retire.test.js` | 无 |
| 交付记录、结果优先的交付页 | `server/crew/delivery.test.js`、`ui/src/room/studio/delivery-record.test.js`、`ui/src/room/studio/delivery-card.test.js`、`ui/src/room/studio/transcript.test.js` | 无 |
| 重启恢复、断线重连 | `server/crew/recovery.test.js`、`server/crew/live-sync.test.js`、`ui/src/store.test.js` | 无 |
| 暂停与成员出错后的一步修复 | `server/crew/live-sync.test.js`、`server/crew/kernel/live/body-swap.test.js`、`ui/src/room/decision.test.js`、`ui/src/room/paused-panel.test.js`、`ui/src/room/chat/view.test.js` | 无 |
| API 路由与动作清单 | `server/route-table.test.js`、`server/crew/route-sweep.test.js` | 无 |
| 驱动边界、运行端口、分层 | `server/crew/engine.test.js`、`server/crew/runtime-port.test.js`、`server/crew/layer-boundaries.test.js`、`server/crew/boundary.test.js` | 真实基座可选 |
| 基座旧房间回收（gc:base） | `server/base-gc.test.js`、`server/crew/base-error.test.js` | 真实基座可选 |
| 成员身体与换模型 | `server/crew/body-change.test.js`、`server/crew/body-check.test.js`、`server/crew/body-spec.test.js` | 无 |
| 界面阶段门与结论卡 | `ui/src/room/studio/message-view.test.js` | 无 |
| 工作室单人启动、规划师组队与工作包派发 | `server/crew/room-create.test.js`、`server/crew/rooms/studio/apply-plan.test.js`、`shared/crew-proposal.test.js`、`server/crew/live-turn-modules.test.js`、`ui/src/room/studio/create.test.js` | 真实模型组队需 dogfood |
| 工作室成员由规划师决定，用户不能加减，只能换模型 | `ui/src/views/side-members.test.js`、`server/crew/live-turn-modules.test.js` | 真实房间需复查 |
| 常驻承诺：创建、暂停/恢复、改口、手动跑、到点开一轮、忙时跳过、错过补一次、连续 3 次没启动停止、归档即停 | `shared/promise.test.js`、`server/crew/promise/actions.test.js`、`server/crew/promise/runtime.test.js`、`server/crew/actions/room/admin.test.js`、`ui/src/room/promise-card.test.js`、`ui/src/room/promise-dialog.test.js` | 真实模型跑一期需 dogfood |
| 邮件投递：设置界面（常见服务商自动识别）、配置落盘权限、正文、收件人、有变化才发、重试和已发回执 | `shared/email-presets.test.js`、`server/crew/delivery/email.test.js`、`server/crew/promise/email.test.js`、`server/crew/promise/email-runtime.test.js`、`server/crew/promise/record.test.js`、`e2e/profile.spec.mjs` | 真实 SMTP 需配置后 dogfood |

## 没在自动覆盖里的

- 真实模型完成一整间房：靠人工 dogfood；模型输出不固定，不能当断言。
- 真实 `git push`、远端分支和 PR：需要外部仓库和凭据，靠 dogfood。
- 复核超时：定时是 10 分钟，单元级只覆盖判定逻辑，没有实跑完整超时。
- macOS 打包、ad-hoc 签名和桌面外壳：手工 smoke，不在单元测试里。
- 外部 MCP 市场、第三方工具和外部通知：没有接入，不做假覆盖。
- 常驻承诺的真实一期：到点或手动跑真实模型还没 dogfood；自动用例只覆盖调度、状态和界面。
- 常驻承诺的邮件投递：真实 SMTP 发送需配置后 dogfood；自动用例只覆盖配置解析、正文和重试收据。
- 常驻承诺的对比与后台：前后期对比、无变化自动停、发现重复后提议、后台常驻未做，不做假覆盖。
- 成员 shell 的 OS 级读写边界：macOS 已有 Seatbelt 写边界（HOME 只读、数据目录不可读、自己的副本可写）；读取其他目录、网络隔离和包级文件边界还没进沙箱，包级仍靠回合后对账。设计见 `docs/plans/sandbox.md`。

## 最近真实运行

- 2026-11-25：三角色真实模型探针（claude CLI 实际走 DeepSeek `deepseek-v4-pro`；基座沙箱 off）。规划 2/3 接住隐藏要求，漏了「不联网」边界；执行 0/2 守住工作包，2/2 都改了工作包外的测试文件（平台已退回），证明 2/2 verified；成本 $0.38 + $0.33。
- 2026-11-25：验收探针 `missing-section` 里验收员写到了执行官的工作副本，因对方本来有改动而没能自动退回；现已改为只读角色出现无法退回的越界时 block 这一轮，等人处理。读取边界仍是判定层核对，不是 OS 沙箱。
- 2026-11-25：macOS Seatbelt 沙箱第一次真实运行（基座 `OMB_BOT_BOX=1 OMB_BOT_BOX_HOME_READONLY=1`）：规划探针 1/1，执行探针 1/1（证明 verified、边界干净）；直接检查 HOME 写被拒、数据目录读被拒、工作副本写成功；探针报告已显示「沙箱 on」。包级写边界仍靠对账。
- 2026-11-25：验收探针夹具修好后 3/3 有效：缺陷 2/2 抓出、对照 1/1 正确放行，误放 0、误拒 0；只取第一份判定，缺陷注入前先读 Lodge `probes.reviewPatch`，没开就退出。
- 2026-11-25：验收探针修复后连跑 5 轮（沙箱 on，claude CLI 实际走 DeepSeek `deepseek-v4-pro`）：15/15 有效，缺陷 8 例抓出 7（88%）、误放 1，对照 4 例正确放行 2（50%）、误拒 2，3 轮被拦停（2 次验收复核超时、1 次房间无消息），成本 $5.37，p50 75s / p95 97s。拦停与误拒仍未解决。
- 2026-11-25：验收探针最终五轮：缺陷 10/10 抓出、误放 0；对照 5/5 正确放行、误拒 0；无效、拦停、无判定、出错都是 0；成本 $5.01，p50 55s / p95 119s；模型池 `claude:claude-sonnet-5` 记 eligible。根因与修法：平台刷新复核副本后重记写边界基线（不再误拦停）；探针缺陷提交成复核副本 HEAD（验收员从 git 取干净副本也带缺陷）；证明入口不再截断成坏命令；对照组检查改成“原样不通过、交付后通过”。
- 2026-11-25：聊天室真房 dogfood（claude CLI 走 DeepSeek `deepseek-v4-pro`）：轻话题请到 2 位（老周、大陈），开场卡写明各自焦点和理由；首轮两人各说一次、结论 100 字内；静音大陈后续聊，只有老周开口，结论正常；固定班底不加不删。
- 2026-11-25：验收门禁补齐后复验（沙箱 on，DeepSeek `deepseek-v4-pro`）：验收探针 3/3 正确（缺陷 2/2 抓出、对照 1/1 放行、0 拦停/无效）；规划探针 3 份契约全部提交，2/3 完整接住（`boundaries` 漏了 `no-dependency`、`keep-manifest`）。新规则：证明要绑定改动（`behavior: change` 时改动前必须失败），并行阶段每个包一份 proof，所有交付都要 verified 证明才能确认，结构化 PASS 必须带在改动前会失败的反例命令。
- 2026-11-25：规划探针 3 例：`two-artifacts`、`boundaries` 完整接住，`exact-format` 漏了 `no-extra-files`；契约 3/3 已提交，成本 $0.40。
- 2026-11-25：`eval:rooms` 本次未跑通（环境问题，房间代码未改）：`revise-tone` 20 分钟未交付（验收员两次被引擎停掉、换模型后仍停在阶段 2），`slice-sheet` 同样停在阶段 2；基座日志显示一次 `terminal` 工具调用挂起 15 分钟、claude 会话 resume 失败。等基座稳定后重跑；`eval:chat` 仍因公开状态不含席位引用而跑不通，聊天室改用真房脚本 dogfood。其余 dogfood：单测 1520、UI 端到端 31、门禁全过。
- 2026-11-21：真实三阶段项目 3/3 交付；最终工作副本 `npm test` 6/6，命令行入口实跑通过。期间发现验收员 PASS 漏 `outsideDiff` 会让房间停在 `signoff`，已改为无效判定回落文本并补回归。
- 2026-11-21：技能收敛后全量 dogfood；`npm test` 1133 通过，UI 12 通过，`eval:rooms` 3/3、`eval:planning` 3/3；`eval:chat` 仍因公开状态不含席位引用而跑不通。
- 仍需真实环境：多执行官并行、真实合并冲突、规划师真实组队、常驻承诺一期、真实 SMTP、成员 shell 的 OS 级写边界。

完整历史留在本地，不入库；自动覆盖以本文件为准。

## 加一条能力时

1. 先写能复现用户路径的自动用例，放在最靠近业务的那一层。
2. 在覆盖表加一行，写清楚需要真实模型、真实基座还是外部服务。
3. 房间动作再加一条：只改 `server/route-table.js` 的动作清单，`route-sweep` 会自动检查处理器和 HTTP 路由。
4. 跑 `npm run check:acceptance`，确认表里引用的用例文件都还在。
