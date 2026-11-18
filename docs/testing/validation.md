# 真实运行记录

这份文件只记自动测试覆盖不到、实际跑过的路径。自动能力仍以 [acceptance-matrix.md](acceptance-matrix.md) 为准。

## 2026-11-18 · MCP gate

- 房间：`room-47b3f3ac`「MCP gate 验收 2」
- 目标：在仓库根目录创建 `gate-check.txt`，内容为 `gate-ok`
- 过程：目标对齐 → 执行官写入 → 验收员复核
- 结果：三步全部通过；验收员实际调用了 `lodge_gate_submit_verdict`
- 证据：verdict 的 `meta.judgment.source` 为 `gate`，`decision` 为 `pass`，`meta.judgment.reason` 来自工具入参；没有权限拒绝
- 未触发：规划师的 `submit_decision`（本轮验收直接 PASS，没有进入返工/交给人）

## 2026-11-18 · 基座清理

- 初始基座：100 个 bot、110 个群；其中 42 个 bot、58 个群属于已从 Lodge 数据中清除的旧房间
- 执行 `npm run gc:base -- --apply` 后：58 个 bot、52 个群；当前房间和另一个应用的 7 个 bot 保留
- 新建探针 bot 成功，`lodge_gate` 在探针上是 `on:true`，探针随后删除

## 2026-11-18 · 原生换身体

- 用探针 bot 验证 `patchMemberBot`：同一 bot 的 `threadId` 不变
- 换模型/设定后 `lodge_gate` 仍为 `on:true`
- 探针 bot 随后删除

## 2026-11-18 · 模式切换

- 工作室 → 聊天室：`room-47b3f3ac` 切换后成员、基座 bot 和 `threadId` 全部不变，新建的 `LodgeHost47b3f3ac` 加入同一个房间群；再切回工作室，规划师收到对齐提示并回话
- 聊天室 → 工作室：`room-9893a8bc` 不选角色时返回“先选一位成员做规划师”；指定甲为规划师、丙为验收员后，角色与权限按定义更新，三个成员的 `threadId` 不变，阶段重建为“目标对齐 / 交接主题 / 验收与结论”
- 界面：切换弹窗正常开关；缺角色时出现规划师、验收员两个下拉，规划师选项会自动从验收员候选中排除；确认后请求带上 `plannerId`、`verifierId`

## 2026-11-18 · 聊天室灵动岛

- 聊天室改用和工作室同一个目标岛：常驻胶囊、悬停/点击展开、目标原句、两步进度（讨论 / 结论）
- 实际页面：`room-9893a8bc` 的岛显示“1/2 讨论”，展开后是目标原句和讨论/结论两步；工作室的岛（`room-47b3f3ac`）保持原样，已交付的示例房仍显示“已交付”
- 已确认的聊天室用“已确认”，不借用工作室的“已交付”

## 2026-11-19 · submit_decision

- 第一次尝试 `room-a8d294c4`：验收员通过 `lodge_gate_submit_verdict` 退回（source=gate），但规划师回合工具调用为 0，判定走文本兜底（source=text）
- 修正：判定提示改为必须调用 `lodge_gate_submit_decision`，工具列表里没有就先 `ToolSearch` 查它；工具描述也写明“判定一律先调用本工具”
- 第二次尝试 `room-3a189c90`「submit_decision 验收 3」：验收员再次 REJECT（source=gate）；规划师回合先 `ToolSearch` 再调用 `mcp__lodge_gate__submit_decision`，`lastPlannerDecision.judgment.source` 为 `gate`，decision 为 `human`，rejectTo 为 `human`
- 同时修正注意力：规划师把步骤交给人后，房间显示“规划师把这一步交给你”并带上 `actionRequired`，不再显示“待重做”

## 2026-11-19 · 判定提交强制

- 规则：判定回合没有门工具提交、首行也不是 PASS/REJECT 或 返工/交给人 时，先向同一位成员催一次“只提交判定”；再次没有提交，就按“规划师没有提交决定”交给人，不再把解释性文字猜成结论
- 自动覆盖：`shared/judgment.test.js` 的锚点判定、`server/crew/live-turn-modules.test.js` 的规划师先催后升级与验收员先催后过期
- 正常路径 smoke：`room-e815cc00` 的验收员只回复 `PASS` 文本，仍然被接受（source=text），没有误触催提交；模型侧没有被强制制造“不提交”的场景，升级路径靠单测覆盖

## 2026-11-19 · 验收按目标原文判断

- 问题现场：`room-e815cc00` 的目标是“内容只有一行 hello”，规划师派发时改成了“内容随意但要是正常文本”，执行官写了中文句子，验收员按“能读到正常文本”判了 PASS
- 修正：规划师派发时带目标原文、验收标准和硬要求（文件名、路径、内容、行数、格式、范围）；验收员提示明确“执行成员或规划师改写的标准不算标准，任何一条不满足就 REJECT，不要用更弱的标准替代目标原文”
- 修正后：同一房间重开第 2 步，规划师派发写成“内容逐字只有一行 hello，不要别的文字、不要多余空行”；执行官照做，验收员通过 gate 记录 PASS，理由是一行 hello 符合目标
- 对照：把内容换回中文句子后，验收员回复“REJECT，hello.txt 内容不是单行 hello，未达房间目标”，没有再拿可读性代替目标；该回合因复核轮次已被重开过期，没有落成 verdict

## 2026-11-19 · 人的输入、用量与诊断

- `room-e815cc00` 重开第 2 步并补一句上下文后，房间多出一条 `human-context` 消息（`source=rewind`），同时保留原来的 `rework` 标记
- 同一轮的执行回合被记进 `room.usage`：2 个回合、输入 49852 / 输出 627 tokens、费用 132956 微美元，状态 `reported`
- 诊断包落盘在 `CrewWorktrees/e815cc00/executor/.crew/rooms/room-e815cc00/diagnostics/`；抽查的一条包含阶段、成员、回合时长、工具调用、用量和 `outcome=evidence`、证据 id、assignment id
- 返工预算与晚到回合围栏没有在真实房间里强制制造，靠 `live-turn-modules.test.js` 覆盖

## 2026-11-19 · 兄弟分支、续接、路由与错误分类

- 兄弟分支：重试单个执行成员时，同一阶段被取消的兄弟分支会一起复活；单测覆盖
- 续接规则：重启后先看这个成员有没有产生过工具活动；有就只发“继续并汇报”，没有才允许重开一次，第二次仍零产出就停下交给人；单测覆盖
- HTTP 路由从 `server/index.js` 抽成 `server/http.js` 的工厂，新增 HTTP 层扫描：只有 2xx/3xx 才计入覆盖，4xx 只算“到达”；真实服务重启后 `/api/state`、`/api/health` 返回 200，未知接口返回 404
- 错误分类补了 forbidden/unavailable/upstream（403/503/502），并支持附加字段；HTTP 扫描覆盖

## 仍需真实环境

- 规划师通过 `submit_decision` 的“返工”路径（本次真跑的是“交给人”）
- 多成员并行时某个分支取消后重跑，兄弟分支是否完整恢复
- macOS 打包、ad-hoc 签名和桌面外壳
