# Room eval

一把尺子：用真实任务建房、真实成员执行、真实验收，再用**独立的检查脚本**核对产出。它不听房间里的自述，只看文件。

## 运行

先启动 Lodge（默认 `http://127.0.0.1:8787`）和基座，再：

```bash
npm run eval:rooms -- --validate              # 只检查题库：原样必须不通过，且自带验收不能原样就绿
npm run eval:rooms                           # 全部 case，各跑一次
npm run eval:rooms -- --case slice-sheet --runs 3
npm run eval:rooms -- --engine pi --model gpt-5.1
npm run eval:rooms -- --engine claude,pi --runs 2   # 交叉对照
npm run eval:rooms -- --memory off,seeded --runs 3  # 记忆 A/B
npm run eval:rooms -- --baseline results/before.json
```

- 每次建房都会用临时 fixture 仓库；默认跑完归档并删除房间，同时收掉这次房间自己的 worktree。
- `--keep` 保留房间、仓库和 worktree，方便打开现场看。
- `--timeout 900` 改单次上限（秒）。
- `--memory seeded` 在临时工作区放一条已发布记忆再建房；默认 `off`。记忆文件写在 Lodge 的 `dataDir/memory`，源码默认 `.data/memory`，桌面版用 `--data-dir` 指过去。
- `--baseline results/before/latest.json` 和上一次同题结果对照：通过率、返工、平均墙钟、平均成本逐项给差值。先跑一次存到 `--out results/before`，改完再拿它当基线。
- 结果写到 `results/latest.json` 和 `results/latest.md`，目录不提交。
- 任何 case 失败命令以非零退出。

## Case

| id | 任务 | 量什么 |
|---|---|---|
| `slice-sheet` | 把 900×300 色带横向切成三张 300×300 | 切图是否真的发生，三张是否不同 |
| `revise-tone` | 只改标题字号和图区圆角 | 改对两处，同时没顺手改掉正文、图注 |
| `verify-catch` | 补完整 `slugify` 的五条规则 | 仓库自带测试只检查函数存在；验收员要按目标原文判断 |

`checks/` 是外部尺子，住在题库里，不在被评测的仓库里，成员改不到。`make-fixtures.mjs` 生成题库图片，保证可重放。

`--validate` 默认要求自带验收在 fixture 上失败；`verify-catch` 是唯一例外，它故意留一份弱检查考验收员，case 里用 `"weakAcceptance": true` 声明，其他 case 再加这个字段前先想清楚是不是在降低门槛。

## 指标

- `pass`：房间交付、最后一条验收通过，**并且**外部尺子通过。
- `rework`：验收退回次数；`reworkedRuns` 有多少次运行经历过返工。
- `elapsedMs`：建房到收口的墙钟。
- `costUsd`：房间记账的用量；未知单独计数，不用 0 冒充。
- `byVariant`：换引擎、换模型各跑一遍，对照通过率和返工次数。
- `comparison`：给了 `--baseline` 时，逐项给出和上次的差值；没有基线就只报本次绝对值。

单次最好成绩不算结论。改提示词、换模型、换工具面前后各跑同一组 case，看通过率、返工次数和成本是否稳定。

## 夜间门禁

一次通过只说明跑得通，不说明稳定。稳定性用重复跑看：

```bash
npm run eval:rooms:nightly      # 3 次/题，结果写 results/nightly
```

- 夜间门禁放在专用机器上，要求 Lodge 和基座都在运行；不要塞进每次提交的 `check:done`。
- 报告看通过率、p50/p95、返工次数和成本，不只看单次最好成绩。
- 发版前用 `npm run eval:rooms -- --runs 5`，把失败分类和未知成本一起写进验证记录。

## 边界

- 调用真实模型，不进入 `npm test`，也不适合无人值守的 CI。
- 房间会写工作区记忆；清理时只删这次临时仓库对应的记忆文件。
- HTML 交付会被平台截图并上传基座附件库，这些附件暂不回收。
