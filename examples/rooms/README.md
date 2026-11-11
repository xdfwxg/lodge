# 示范房间

这里放可直接打开的 Lodge 交接包（`lodge.room-handoff.v1`）。

| 文件 | 形态 | 内容 |
| --- | --- | --- |
| `room-cli-verbose.lodge.json` | 三席 · git · 进行中 | CLI `--verbose`，决策阶段已过，交付阶段有命令证据与 PASS |
| `room-oauth.lodge.json` | 三席 · git · 进行中 | OAuth 迁移，目标对齐阶段 |
| `room-readme.lodge.json` | 三席 · git · 已完成 | README 安装说明，两段命令验收与结论 |

**这些是模拟样本**：内容来自 `server/crew/seeds.js`，用于演示交接包、目标岛和复盘视图，不是真实交付。包内 `sample.kind` 为 `simulated`，命令证据标了 `simulated` 与 `sample`。

## 打开

Lodge 侧栏「打开」→ 选择 `.lodge.json`。导入后是只读交接记录，可看 BRIEF、对话、事件、证据和复盘；要继续工作，用「基于此记录续做」，并指定本地仓库或目录。

## 重新生成与导出

```bash
npm run samples:generate
```

从真实房间导出公开样本：

```bash
npm run samples:export -- --data .data --room room-xxxx --out examples/rooms/my-room.lodge.json
```

导出会替换本机绝对路径，并脱敏私钥、常见 API key、Bearer token、邮箱与 URL 凭据；`redactionCount` 记录替换次数。提交到公开仓库前仍应人工通读，确认没有未公开业务内容。

这些样本不是模板市场；只用于本地演示与交接包格式说明。
