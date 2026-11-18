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

## 仍需真实环境

- 规划师通过 `submit_decision` 的返工/交给人路径
- 多成员并行时某个分支取消后重跑，兄弟分支是否完整恢复
- macOS 打包、ad-hoc 签名和桌面外壳
