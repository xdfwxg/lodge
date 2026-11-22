# Lodge

以房间为一等本体的多 Agent 工作间：聊天室负责讨论，工作室负责交付。基座是 OpenMausBot OSS；产品差异层在 `server/crew` 与 `ui`。

## 常用命令

- 开发：`npm run dev`
- 单测：`npm test`
- UI 端到端：`npm run test:ui`
- 构建：`npm run build`
- 真实评测：`npm run eval:rooms`、`npm run eval:planning`（需要 Lodge 8787 和基座 8799）
- 完成前验证：`npm run check:done`（单测、UI 端到端、构建和门禁）
- 门禁：`npm run check:unused`（knip）、`npm run check:deps`（dependency-cruiser）、`npm run check:docs`、`npm run check:acceptance`、`npm run check:regressions`

## 边界

- 业务逻辑只写 `server/crew/`；驱动差异放 `server/base.js`；共享契约在 `shared/`；界面在 `ui/src/`。
- 只有两套房间引擎：聊天室（规则）和工作室（Planner/Executor/Verifier）。不新增第四种底层角色，不把完整执行引擎挂进聊天室。
- 不引 CrewAI/LangGraph/AutoGen 这类编排框架；房间、阶段、证据是唯一真相。
- 不自动 commit / push / 开 PR；外部动作先问人。提交前由本地 hook 跑 `npm run check:done`，没过就拦下。
- 旧数据直接清掉，不留兼容 shim。
- 真 bug 先补回归测试或门禁；没有测试缝先修架构，不先改提示词。
- 用户能看到的文案走 `shared/product-copy.js` 和文案门禁；内部词、第二人称状态不进主界面。

## 产品判断

取舍标准与灵感来源见 `乔布斯.md`；设计和评审先按它，再谈方案。界面用词以 `docs/design.md` 和 `shared/product-copy.js` 为准，文案改动后跑 `npm test`。

- 先写一句「用户打开后 30 秒内发生什么」，再画界面。
- 先问用户要完成什么，再问要加什么功能。
- 一屏只留一个主要决定；能删就删。
- 默认给结果，过程折叠；内部机制不上主界面。
- 端到端跑通才算完成，不做演示级半成品。
- 找不到让人记住的那一个点，就先别做。

## 回复收尾

有产品取舍时，最后一行写一句「乔布斯视角：…」。只写取舍，不写语录：

- 先砍什么
- 留下什么
- 为什么

没有产品取舍时直接不写这一行；不要硬编，也不要写「这次没有产品取舍」占位。

## 设计复检

遇到方案、架构或界面取舍时，先问自己一次「还有没有更好的设计？」再动手：

- 有更好的：给一个替代方案，说明代价，并给推荐。
- 没有：写「没有更好的设计」，按当前方案继续。

纯执行、事实回答不用硬问。

## 文档

- 架构与角色技能：`docs/architecture.md`
- Agent 设计门禁：`docs/agent-design.md`
- 长期项目设计：`Lodge.md`「工作室怎么读」与 `docs/architecture.md` 的轮次部分
- 验收矩阵：`docs/testing/acceptance-matrix.md`
- 真实运行记录：`docs/testing/validation.md`
