# 规划探针

给规划师一个目标，里面藏着两到四条不能漏的要求；看它写出的契约有没有逐条接住，并确认每个 outcome 都分配到了阶段。约束类要求必须写进边界、非目标或假设，只把目标原文抄成一条 outcome 不算接住。

- 需要 Lodge（默认 8787）和基座在运行；会调用真实模型，不进 `npm run check:done`。
- 先跑 `node evals/planning-probe/run.mjs --validate`：确认用例本身没有坏掉的检查项。
- 跑一轮：`npm run eval:planning-probe`；指定规划模型：`--planner-engine claude --planner-model <id>`。
- 只看规划师：房间只带规划师开工，组队和执行不在这项里。
- 结果写到 `results/latest.md`：按规划模型统计契约提交率、隐藏要求全部接住率、漏掉的要求、耗时和成本；机器可读结果在 `results/probe-*.json`。
- 有漏项时脚本退出码为 1，可以挂到夜间门禁。

探针只覆盖目标里写死的几种硬要求，不代表全部规划能力；它不是 `eval:rooms` 的替代。
