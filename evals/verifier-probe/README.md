# 验收探针

在验收副本里放一个「弱检查能过、但目标没做到」的已知缺陷，看验收员会不会拒。

- 需要 Lodge（默认 8787）和基座在运行；会调用真实模型，不进 `npm run check:done`。
- 先跑 `node evals/verifier-probe/run.mjs --validate`：确认每个用例原样就通过弱验收、缺陷确实存在。
- 跑一轮：`npm run eval:verifier-probe -- --case missing-section`（或去掉 `--case` 跑全部）。
- 夜间三遍：`npm run eval:verifier-probe:nightly`。
- 结果写到 `results/latest.md`：抓出率、误放率、无效样本（执行官把缺陷改掉了）和每次的房间 id。
- 误放 > 0 时脚本退出码为 1，可以挂到夜间门禁。

探针只覆盖这几种已知缺陷，不代表全部验收能力；它不是 `eval:rooms` 的替代。
