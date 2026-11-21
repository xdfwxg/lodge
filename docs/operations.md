# Lodge · 运行与运维

> 本文回答：怎么运行、基座和 CLI 怎么接、坏了怎么恢复、怎么发布。
> 产品判断与**原则总表**见 [Lodge.md](../Lodge.md#原则总表)，结构见 [architecture.md](architecture.md)，界面见 [design.md](design.md)。

## 开发运行

```bash
npm install
npm run dev        # 服务 8787 + UI 5173
npm test           # 独立临时工作区里跑测试
npm run build      # 构建 ui/dist
npm run desktop    # 构建后启动 Electron
npm run test:e2e   # 单房间端到端
```

开发模式需要本机运行基座，默认 `http://127.0.0.1:8799`，可用 `CREW_BASE_URL` 覆盖。发布包会把基座打进去，用户不需要仓库或系统 Node。

## 桌面版

Electron 壳只做三件事：启动 Lodge 服务、把同源 UI 装进窗口、寻找或启动基座。

- 打包：先在 `crew-chat-base` 运行 `pnpm build:server`，再 `npm run package:mac`；产物在 `release/`
- 只发 zip，ad-hoc 签名，不公证、无自动更新；首次打开需在「隐私与安全性」点「仍要打开」
- Windows/Linux 打包脚本已有，未真机验证

## 基座与 CLI

基座查找顺序：`CREW_BASE_URL` → `127.0.0.1:8799` → `LODGE_BASE_DIR` / 已保存设置 / `Resources/base` / `~/workspace/crew-chat-base`。

源码模式重启基座时，要让它继承 `~/.claude/settings.json` 的 CLI 环境（`ANTHROPIC_BASE_URL`、`ANTHROPIC_AUTH_TOKEN` 等）；否则 `claude` CLI 会报 `Not logged in`，房间以「规划师没能回应」暂停。清空基座数据后尤其要检查。

Lodge 不自己发现 CLI：基座探测 PATH 与已知目录，Lodge 只读 `/api/instances`。Pi 是 BYOK，凭据在 `~/.pi/agent/auth.json`；装好或更新后要重启基座，`pi` 才会从 unavailable 变成 available。

## 内置 runtime

发布包可带 `Resources/runtimes/<id>/`（当前是 Pi），`runtime.json` 只写分发信息；登录命令来自基座 driver。构建用 `npm run prepare:runtimes`，开发可用 `LODGE_RUNTIMES_DIR=/path/to/runtimes npm run desktop`。

## 受控浏览器

每位成员默认带只读公网浏览，不需要勾选，也没有房间级权限。建房和加成员时自动挂 `chrome-devtools` 只读 grant， Lodge 首次需要时把 `chrome-devtools-mcp@1.13.0` 注册到基座。

- 所有角色同一份能力：只读研究直接放行；命令、写入、付款仍逐次确认。
- 独立临时 profile、headless；禁止输入、JS 求值、本地文件、localhost 和常见私网。
- 浏览器没准备好时，系统拿掉这项能力、房里留一句说明，房间照常开始，不挡住建房。

## 上下文装配

`server/crew/prompt-context.js` 把房间事实裁成提示词：最近发言、早期摘要、证据摘要、历史阶段各有硬预算；完整日志和 diff 留在证据文件里。**这是房间自己拼的提示词，不是替 harness 管 agent 上下文。**

能用测试、类型、接口或工具面拦住的，不写进提示词；大部分输入来自基座线程历史。

## 工作区与审批

- `CREW_NODE_MODULES_MODE=copy|link|none`，默认 `copy`；`link` 会让写成员穿过 symlink 改到源目录，只适合调试。
- `.env` / `.env.local` 只复制给执行成员，不给验收员。
- 原地目录（direct）没有验收副本：验收员只读、不能 exec；敏感项目用 git 或复制工作区。
- 路径清理只允许在 `CREW_WORKTREE_ROOT` / `CREW_COPY_ROOT` 之下。
- 审批桥是「人确认」通道，不是命令防火墙；真正的边界是成员工具面与 `read/exec/write` 声明。
- pending 审批不会被历史截断；房间断开或过期时向基座发 deny，不留永远等待的卡。
- 所有成员隐藏基座 agents 协调面；执行成员再隐藏 `lodge_gate`，只有规划和验收能提交判定。
- 证据、命令输出和 diff 进提示词前去掉零宽/双向/控制字符，按预算截断（证据 4000、输出 6000、diff 12000），用围栏标成数据。

## 房间怎么说话

聊天室和工作室是两条并列产品线，成员都是独立机器人，平台不代写气泡。

- 聊天室：内容自由、节奏受控。一轮默认 6 次发言、最多 20 次，按成员数均分；发言顺序随机，轮次允许时先保证每位成员说一次，之后随机；冷场或超时由房间按剩余配额补位，主持最后收一段总结。用户不带 `@` 时由主持回答；带 `@` 时直接交给被点名的成员，结论后也一样。成员之间不用 `@` 交接；界面不显示「第几轮」。
- 工作室：规划师只说做什么，执行官只报结果，验收员只给判定，三边都不写 `@`。系统在共享房间发 `@执行官` 派活、`@验收员` 请复核、退回时 `@执行官` 重做、通过时 `@规划师` 收尾；下一位和 `@` 由 `rooms/studio/relay.js` 决定，只有重做预算用完、合并冲突或没有执行成员时才回到规划师/人。两种房间的基座都写 `followMentions: false`，成员回复里的 `@` 不会唤醒下一棒。并行执行在各自 worktree 里进行，但群聊只有一套。房间只记 Assignment、证据和阶段状态。
- 模式在建房时确定，运行期不切换；聊天室成员开聊后不加、不移。工作室成员只在未完成时能加，交付后开新房。
- 时间线把工具步骤合成一行摘要，命令、diff、证据细节折在消息下面。
- 交付后不原地改：输入框保留，能问规划师；「接着改」在同一工作室开下一轮，沿用原班人马和工作区，旧轮只读并留在历史里。上一轮检查只作参考，新一轮按新目标验收。

## 判定与人的门

- 验收员和规划师共用一份判定契约：首行锚点（`PASS/REJECT` 或 `返工/交给人`），后可带 JSON 理由和发现项。
- 工具优先：`submit_verdict` / `submit_decision`；工具确实不可用时才用文本兜底。
- 判定回合没有工具提交、首行也不是合法锚点：先催一次；再一次没有，规划师按「没有提交决定」交给人，验收员按无判定收口，不猜结论。
- 中间步骤验收通过就自动收口并开始下一步；只有整轮的最后一步停在人的「确认」，由人收下交付。
- 每阶段最多 3 次返工；用完转「交给人」，给继续返工、改目标或人接手三个选择。
- 验收以房间目标原文为准，规划师派发时不改写硬要求，验收员缺一条就 REJECT。
- 人的输入写成 `human-context`；主时间线只显示一条气泡。交给人之后，下一次输入会作为补充上下文重跑这一步。
- 晚到回合不污染新结果：开始早于当前交接或本步开始的回合丢弃，留 `turn.stale` 事件。阶段开始时记下时间，避免上一步还没结束就被 @ 醒的回合被当成新一步的证据。
- 运行中的房间只在真有回合时，把输入框的发送键换成「停下」；确认后取消当前回合并暂停，已产出内容保留。成员级挂起收在成员行菜单里，叫「先别给 TA 派活」。

## 检查与证据
- 交付卡可以展开「PR 文案」：只生成 Summary、Before/After 证据、Door 和 Blast Radius，不会自动 push；复制后由人决定是否创建 PR。

- 产品从仓库认检查：`package.json` 的 `test`（按锁文件选 npm/pnpm/yarn）、`Cargo.toml`、`go.mod`、明确的 pytest、`Makefile` 的 `test`。
- 在独立副本里跑，命令、退出码、输出、diff、改动文件留证据；认不出来就明说，不拿空命令为难人。
- 自动检查不通过就退回重做；同一失败原地再现、超过 3 次、超过 15 分钟或额度用完就停下交给人。
- 停下状态分 `blocked / limit-reached / needs-input`，界面只说一句人话，细节留在记录里。
- 暂停的房间显示「继续」；成员出错（登录失效、额度用完、没回应）时先给「重新登录」或「换个模型」，修好自动恢复。
- 每回合写诊断到 `.crew/rooms/<房间>/diagnostics/<turnId>.json`，含阶段、成员、时长、工具、用量和终止去向。
- 排查一轮：`npm run replay:round -- --room <房间 id> [--round <轮次 id>]` 只读重放事件，列出阶段和交接的 event/current 差异；不改房间状态。
- 结果正文走 `GET /api/rooms/:id/artifact?path=...`，只允许房间工作区；文本最多 256KB，图片最多 6MB，其他二进制回退到打开文件/文件夹。

## 例行工作

- 例行工作挂在已完成房间上，对外一行；每次到点生成新的执行，最新一次是主结果，往次进历史。
- 入口在结果下面：「以后每天 8:00 再做一遍」；开始前选周一到周日和 24 小时时间，开启后还能改。不出现 cron。
- 错过只补一次；同一例行同时只跑一次；连续 3 次没启动就停。最多 20 个，保留最近 20 次。
- 归档或删除目标房会停掉例行和正在跑的那次；取消归档不自动恢复。

## 影子评审

每间工作室内置一个隐藏成员，不占席位、没有工具。只在验收命令弱、被退回、改动大或碰到配置时取一份对照意见；只写摘要、理由、风险、缺失证据，按阶段覆盖，不进验收提示词、不改变 PASS/REJECT、不阻塞验收。失败只留一句提示。

## 文案与错误

- 只出现人能看懂的一句话：发生了什么、下一步做什么。
- 系统消息走 `systemNotice`：原始错误写进 `meta.detail` 和日志，不拼进正文；需要人处理的显示，自动重试/后台建议不占时间线。
- 界面错误走 `error-text.js`：中文业务原因保留，英文/网络错误换成人话。
- 不写实现旁白；小字只留真实错误、非显然后果和必须知道的限制。

## 附件与上传

输入框左边是「+」，也可拖到房间或粘贴截图。附件上传到基座附件库，再把标记随消息送进会话：图片由 harness 转成原生输入，文本文件带正文，其它文件留路径。房间不存副本。

- 一条消息最多 10 个附件、总量 40MB；单张图片 10MB，单个文件 25MB；超限在上传前拦截。
- 只接受基座生成的 uuid 文件名；伪造路径在消息动作和基座派发时各校验一次。
- 交付里的图片按组显示；HTML 交付由平台截图做像素检查。

## 能力声明与视觉验收

- 建房时把实例的 `images` 和成员工具权限写进 `member.body.capabilities`；声明不是验证。
- 验收员没显式指定引擎时，先选声明能看图的实例，其中再优先不同厂商；没有能看图的才退回跨厂商独立复核。眼睛和独立性只能保一个时，先保眼睛。切换和兜底记在 `engineFallbacks`。
- HTML 交付在复核前由平台用无头 Chrome 截图（`screenshot.js`）、做像素检查（`visual-audit.js`），上传附件库并放进验收提示词；交付卡把渲染图放最前。
- 判定可带 `visual: { seen, colors, contrast }`；平台只校验形状，不要求两次渲染颜色数相同。缺了标 `visualMissing`，交付卡写「这次验收只看文字证据，渲染图没有核对」；`seen:false` 是合法结果，如实标注。
- 成本按房间实际用量记账，上限沿用基座预算；没有静默升级。

## 房间记忆

- 所有阶段通过的房间追加一条记忆，按 `sourceRepo` 归到工作区；同房间不重复写。
- 每条含目标、验收结论、阶段状态、改动文件、最近两次退回理由、完成时间和来源房间；默认「待审核」，发布后才进入新房间的交接包（最多 3 条，标「只读参考」）。
- 交接包里带上「当时改过」的文件和「上次被退回」的理由，规划和执行少走一遍老路；它仍只是参考，不是指令。
- 上限：每工作区 200 条、单条 16KB、单文件 1MB。删除写进追加日志，不再列出。
- 记忆在 `memory/*.jsonl`，和数据库分开备份；启动与每 6 小时复制到 `backups/memory-*`，保留 10 份。

## 数据、日志与恢复

- 源码数据：仓库 `.data/`；桌面数据：`~/Library/Application Support/lodge/data`；基座数据：`.../lodge/base-data`；日志：`.../lodge/logs/server.log`。
- SQLite（`crew.db`）是房间、消息、交接和审计的唯一真相；`transcript.jsonl` 是逐条 fsync 的恢复日志和可读镜像，启动时只补「日志已写、库没写」的消息。
- 启动前和每 6 小时留 `backups/crew-<时间>-<原因>.db`，保留 10 份；工具步骤保留最近 2000 条，审计事件 5000 条；启动检查 `integrity_check`，坏库拒绝启动。
- 恢复：先退出 Lodge，再 `npm run data:restore -- --list` / `--latest` / `--backup <file>`；桌面版加 `--data-dir "$HOME/Library/Application Support/lodge/data"`。恢复前会自动留 `pre-restore` 快照。
- 重置工作区：`npm run data:reset -- --workspaces` 会先把 `CrewWorkspaces` / `CrewWorktrees` 归档到 `.data/backups/workspaces-<ts>/`，再删除；归档失败就中止，不删原目录。`--no-archive` 才直接删。
- 成对恢复：`npm run data:restore -- --all` 恢复最新数据库和最新工作区归档；也可以 `--workspaces <name>` 单独恢复。目标目录已存在时默认拒绝，`--force` 才覆盖。
- 停止窗口不删数据；退出 app 会停 Lodge 和它启动的基座。不要在共享基座上用空数据目录启动第二个 Lodge：空库首次启动会清掉基座里所有 Lodge 孤儿资源。

## 发布

推送 `v*` 标签时，`.github/workflows/release.yml` 构建 Mac arm64 zip 和 Windows/Linux 安装包，做包内容检查和启动 smoke；Mac zip 校验 ad-hoc 签名并生成 `SHA256SUMS.txt`。没有自动更新，发布后手动下载替换。

## 验证
- 一次构建结束、尤其是走偏之后，运行 `npm run retro:env`：它按严重度列出这次改动的环境缺口（缺测试、缺文档、空白错误、改动面过大、未提交改动），不进入房间角色。

`npm test`、`npm run build`、`npm run test:ui`（Playwright + axe，覆盖首屏、结果卡、目标面板、窄屏暗色）、`npm run prepare:runtimes`、`npm run package:mac:dir`、`npm run smoke:package`。端到端验证需要 Pi 已登录：新建工作室，执行引擎选 Pi，给一条可执行的验收命令，确认执行成员实际跑了命令并产生证据。

## 评测

- `npm run eval:planning` 评开工卡；`npm run eval:rooms` 评交付：真实建房、真实成员、真实验收，再由题库外的独立脚本核对产出。两者都调用真实模型，不进入 `npm test`。
- 固定题覆盖切图、改稿和弱检查下的验收；每条记通过、返工次数、墙钟和成本，可换引擎或模型交叉跑。
- `--memory off,seeded` 对照「有没有工作区记忆」；`--baseline` 和上一次同题结果比通过率、返工、墙钟和成本。
- `npm run eval:rooms -- --validate` 只检查题库：原样必须不通过。题库细节见 `evals/rooms/README.md`。
