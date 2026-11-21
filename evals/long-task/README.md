# Long-task eval

测的不是单轮聪明，是长期工作间的地基：跨轮、重启、停止、归档、预算和人工门。

## 运行

```bash
npm run eval:long-task
npm run eval:long-task -- --case two-rounds
npm run eval:long-task -- --keep        # 保留临时库和工作目录
```

每个场景起两个独立的 `node` 进程：第一个进程做前半段并退出，第二个进程重新打开同一个 SQLite 库，先 `reconcileRounds`、再 `reclaimWork`，然后继续。中间是一次真正的进程退出，不是把变量留在内存里假装重启。

不调用模型，不写房间记录；场景只驱动轮次、队列、恢复和账本。

## 场景

| id | 做什么 | 看什么 |
|---|---|---|
| `two-rounds` | 同一工作室完成第一轮，开第二轮，中途重启 | 第二轮还在，旧轮只读，消息不串轮 |
| `stop-next` | 第一轮停止后开第二轮 | 轮次是 `stopped`，房间回 `idle`，旧队列项被取消 |
| `archive-restore` | 归档工作室，重启后恢复，再开一轮 | 归档状态持久，旧轮仍只读，恢复后能继续 |
| `budget` | 用量达到预算后暂停 | 重启后仍是 `paused/budget`，派发被拦住 |
| `human-gate` | 规划师把这一步交给人 | 决定在重启后还在，人工介入被记账 |

## 指标

结果写到 `results/latest.json` 和 `results/latest.md`（不提交）：

- 成功率：场景断言是否全过。
- 轮次数和完成数：跨轮是否真的继续。
- 返工次数：`rework` 消息数。
- 人工介入次数：场景显式记录的人工门。
- 单位交付成本：总成本 / 完成轮次；没有交付时写 `—`。
- p50 墙钟：所有场景耗时的中位数。

## 边界

- 这是确定性的内核评测，不是模型能力评测；真实模型交付仍用 `eval:rooms` / `eval:planning`。
- 场景不覆盖真实合并冲突、真实审批卡和真实 CLI 退出；那些仍由单测和 dogfood 覆盖。
