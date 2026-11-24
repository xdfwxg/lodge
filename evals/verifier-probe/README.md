# 验收探针

在验收副本里放一个「弱检查能过、但目标没做到」的已知缺陷，看验收员会不会拒；同时跑一个本来就合格的对照，看验收员会不会误拒。

- 需要 Lodge（默认 8787）和基座在运行；会调用真实模型，不进 `npm run check:done`。
- 先跑 `node evals/verifier-probe/run.mjs --validate`：确认每个缺陷用例原样就通过弱验收、缺陷确实存在；对照组确实没有缺陷。
- 跑一轮：`npm run eval:verifier-probe -- --case missing-section`（或去掉 `--case` 跑全部）。
- 指定验收模型：`--verifier-engine pi --verifier-model pi-3`（执行官用 `--worker-engine/--worker-model`）。
- 夜间五遍：`npm run eval:verifier-probe:nightly`；跑完把模型分池写到 `~/.lodge/verifier-pool.json`，平台会拒掉误放率超过 5% 的验收模型。
- 结果写到 `results/latest.md`：抓出率、误放率、误拒率（对照样本）、无效样本、成本、p50/p95 耗时、每次房间 id，以及按验收模型分组的模型池；机器可读结果在 `results/pool.json`。
- 误放或误拒 > 0 时脚本退出码为 1，可以挂到夜间门禁。模型池门槛：同一模型至少 10 个缺陷样本、5 个对照样本；误放率 > 5% 记为 excluded。

只看抓出率会奖励“什么都拒”的验收员，所以缺陷样本和对照样本一起报。探针只覆盖这几种已知缺陷，不代表全部验收能力；它不是 `eval:rooms` 的替代。
