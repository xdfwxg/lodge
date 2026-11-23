# 历史检索基准

测长房间里的历史检索耗时，不走模型，也不需要 Lodge 在跑。

- 默认灌 5000 条消息、跑 20 次查询，报 p50 / p95；p95 超过 250ms 退出码为 1。
- `node evals/history-bench/run.mjs --count 20000 --queries 50 --max-ms 400`
- 消息直接写 SQLite 与 FTS 索引，跳过逐条镜像；查询走真实的 `searchMessages`。

它只证明检索不会随房间变长而失控，不判断检索结果好坏。
