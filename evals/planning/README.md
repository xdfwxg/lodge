# Planning eval

黄金房间评测：验证队长开工卡的语义质量，而不是机制测试。

## 运行

先启动基座（默认 `http://127.0.0.1:8799`），再：

```bash
npm run eval:planning
npm run eval:planning -- --runs 3
npm run eval:planning -- --case solo-cli
```

这个命令会调用真实模型，因此**不进入 `npm test`**。结果写到 `results/latest.json` 和 `results/latest.md`，该目录不提交。任何 case 失败时命令以非零退出，适合手动门禁或后续 CI。

## Case

- `solo-cli`：小改动，期望单人、无验收席位、可执行测试。
- `api-rate-limit`：单服务加限流与文档，允许一个独立验收席位。
- `parallel-settings`：前后端可独立改动，期望至少两个执行席位。

fixture 是普通目录；runner 会复制到临时目录、`git init` 并提交，再交给真实的 `recommendRoster`。不会写入 fixture。

## Rubric

硬检查在 [planning-eval.js](../../server/crew/planning-eval.js)：

- 有开工卡；done 1–6 条且至少一条可核对；席位至少一个执行、最多一个队长/验收；
- 有验收席位时必须有可执行命令；
- 问题 ≤3，每个带推荐答案，不问模型/人数/席位/并行机制；
- case 约束：席位上下限、验收命令正则、done 关键词。

每次改队长提示词、换模型或换引擎，重放同一组 case；看通过率和失败类型，不拿单次最好成绩当结论。

## 边界

它评的是开工卡，不是交付质量；交付质量仍由真实房间、证据和验收命令验证。评分器的关键词与机制问题规则会误判，需要在 `latest.json` 里回看原始建议。
