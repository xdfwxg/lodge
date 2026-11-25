# Lodge · 运行与运维

> 本文回答：怎么运行、基座和 CLI 怎么接、坏了怎么恢复、怎么发布。
> 通用判断与**原则总表**见 [思想.md](../思想.md#原则总表)，结构见 [architecture.md](architecture.md)，界面见 [design.md](design.md)。

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

每位成员默认带只读公网浏览，不需要勾选，也没有房间级权限。建房和规划师开通成员时自动挂 `chrome-devtools` 只读 grant， Lodge 首次需要时把 `chrome-devtools-mcp@1.13.0` 注册到基座。

- 所有角色同一份能力：只读研究直接放行；命令、写入、付款仍逐次确认。
- 独立临时 profile、headless；禁止输入、JS 求值、本地文件和本机地址。拦截模式按 URLPattern 逐条写本机地址（localhost、127.0.0.1、0.0.0.0、`.local`、`.internal`）；URLPattern 不接受 `127.*` 这类部分 IPv4 通配或 IPv6 字面量，所以这两类没有假装拦住。
- `server/browser-mcp.integration.test.js` 会用交付时的参数真的启动 `chrome-devtools-mcp`、走 MCP 握手并确认输入与 JS 求值工具确实不存在；参数写错时在测试里就红。
- 角色技能包装进基座技能库后，基座没有“覆盖同名技能”的接口。Lodge 升级后如果 `skills/role-packs/` 的文案变了，基座保留旧版本并在日志里写 `保留基座版本，不覆盖`，但不会拦住建房；要真正更新，先在基座里移除同名技能，再重启 Lodge 重新导入。
- 浏览器没准备好时，系统拿掉这项能力、房里留一句说明，房间照常开始，不挡住建房。

## 上下文装配

`server/crew/prompt-context.js` 把房间事实裁成提示词：最近发言、早期摘要、证据摘要、历史阶段各有硬预算；完整日志和 diff 留在证据文件里。**这是房间自己拼的提示词，不是替 harness 管 agent 上下文。**

能用测试、类型、接口或工具面拦住的，不写进提示词；大部分输入来自基座线程历史。

## 工作区与审批

- `CREW_NODE_MODULES_MODE=copy|link|none`，默认 `copy`；`link` 会让写成员穿过 symlink 改到源目录，只适合调试。
- `.env` / `.env.local` 只复制给执行官；规划师和验收员的只读副本会删掉仓库里跟踪的 `.env`。
- 原地目录（direct）没有独立验收副本：验收员和执行官共用办公目录，只读靠工具面约束；敏感项目用 git 或复制工作区，让验收员在自己的副本里跑检查。
- 路径清理只允许在 `CREW_WORKTREE_ROOT` / `CREW_COPY_ROOT` 之下。
- 审批桥是「人确认」通道，不是命令防火墙；真正的边界是成员工具面与 `read/exec/write` 声明。
- pending 审批不会被历史截断；房间断开或过期时向基座发 deny，不留永远等待的卡。
- 所有成员隐藏基座 agents 协调面；执行官和聊天成员隐藏整个 `lodge_gate`。规划和验收再按工具分开：规划师不拿 `submit_verdict`，验收员只拿 `submit_verdict`，派活、拍板、退回、停下这些工具只归规划师。
- 证据、命令输出和 diff 进提示词前去掉零宽/双向/控制字符，按预算截断（证据 4000、输出 6000、diff 12000），用围栏标成数据。

## 房间怎么说话

聊天室和工作室是两条并列产品线，成员都是独立机器人，平台不代写气泡。

- 聊天室：内容自由、节奏受控。一轮默认 6 次发言、最多 20 次，按成员数均分；轮次允许时先保证每位成员说一次，之后按 proposer → critic → synthesizer 互补，最后随机；冷场或超时由房间按剩余配额补位。主持默认写「共识 / 分歧 / 未定」三段，明确的“下一步”另起一行作为待办，可直接转成工作室交接；只有用户明确要“分点/清单/待办/表格”时才用六段结构。用户不带 `@` 时由主持回答，主持不自行开轮；从成员选择器里点名具体成员时，直接交给被点名的人，结论后也一样，消息上安静标「直接问 X」；轮次运行中直接点名会被拒绝，等结束或先叫停。手打 `@名字` 不算结构化点名。`@所有人` 是开一轮受配额限制的讨论；正在讨论时明确说等这一轮结束。明确说“再走一轮/大家说说”也会开一轮。开轮前检查房间预算；成员之间不用 `@` 交接；界面不显示「第几轮」。
- 工作室：规划师只说做什么，执行官只报结果，验收员只给判定，三边都不写 `@`。系统在共享房间发 `@执行官` 派活、`@验收员` 请复核、退回时 `@执行官` 重做、通过时 `@规划师` 收尾；下一位和 `@` 由 `rooms/studio/relay.js` 决定，只有重做预算用完、合并冲突或没有执行官时才回到规划师/人。两种房间的基座都写 `followMentions: false`，成员回复里的 `@` 不会唤醒下一棒。并行执行在各自 worktree 里进行，但群聊只有一套。房间只记 Assignment、证据和阶段状态。
- 模式在建房时确定，运行期不切换；聊天室成员开聊后不加、不移。工作室成员由规划师组队，用户不能加/减；成员登录失效或额度用完可以换模型修故障。
- 时间线把工具步骤合成一行摘要，命令、diff、证据细节折在消息下面。
- 交付后不原地改：输入框保留，能问规划师；在输入框说下一轮要改什么，同一工作室开下一轮，沿用原班人马和工作区，旧轮只读并留在历史里。上一轮检查只作参考，新一轮按新目标验收。

## 判定与人的门

- 验收员和规划师共用一份判定契约：首行锚点（`PASS/REJECT` 或 `返工/交给人`），后可带 JSON 理由和发现项。
- 工具优先：`submit_verdict` / `submit_decision`；工具确实不可用时才用文本兜底。
- 判定回合没有工具提交、首行也不是合法锚点：先催一次；再一次没有，规划师按「没有提交决定」交给人，验收员按无判定收口，不猜结论。
- 验收通过就自动收口并开始下一步；整轮的最后一步验收通过后直接交付，不需要人再确认。人看结果不满意时，可以退回重做或开下一轮。
- 每阶段最多 3 次返工；用完转「交给人」，给继续返工、改目标或人接手三个选择。
- 验收以房间目标原文为准，规划师派发时不改写硬要求，验收员缺一条就 REJECT。
- PASS 的覆盖表按阶段核对：中间步骤对本步交付物，最后一步还要对整轮完成条件；缺一条先退回重问，第二次仍缺就按本轮回合未通过处理。
- PASS 之前必须有亲手验过的工具痕迹：读一个改动文件或跑一条检查；只有判定工具调用的回合不算。
- 验收员模型先过探针池：夜间 `npm run eval:verifier-probe:nightly` 按模型写 `~/.lodge/verifier-pool.json`；误放率超过 5% 的模型会被平台拒绝。未实测或样本不足的模型可以开工，但房间会标出来。
- 人的输入写成 `human-context`；主时间线只显示一条气泡。交给人之后，下一次输入会作为补充上下文重跑这一步。
- 晚到回合不污染新结果：开始早于当前交接或本步开始的回合丢弃，留 `turn.stale` 事件。阶段开始时记下时间，避免上一步还没结束就被 @ 醒的回合被当成新一步的证据。
- 运行中的房间只在真有回合时，把输入框的发送键换成「停下」；确认后取消当前回合并暂停，已产出内容保留。成员级挂起收在成员行菜单里，叫「先别给 TA 派活」。

## 结果与证据
- 交付卡可以展开「PR 文案」：只生成 Summary、Before/After 证据、Door 和 Blast Radius，不会自动 push；复制后由人决定是否创建 PR。

- 平台每步收集结果证据：候选人提交、diff、改动文件、执行官的结果说明；没有结果证据就不进入复核。
- 验收员自己决定怎么验：读文件、跑仓库里的检查、试边界输入；平台不预设命令，也不替它跑。
- 验收不通过就退回重做；同一失败原地再现、超过 3 次、超过 15 分钟或额度用完就停下交给人。
- 停下状态分 `blocked / limit-reached / needs-input`，界面只说一句人话，细节留在记录里。
- 暂停的房间显示「继续」；成员出错（登录失效、额度用完、没回应）时先给「重新登录」或「换个模型」，修好自动恢复。
- 每回合写诊断到 `.crew/rooms/<房间>/diagnostics/<turnId>.json`，含阶段、成员、时长、工具、用量和终止去向。
- 排查一轮：`npm run replay:round -- --room <房间 id> [--round <轮次 id>]` 只读重放事件，列出阶段和交接的 event/current 差异；不改房间状态。
- 排查聊天：`npm run replay:chat -- --room <房间 id> [--round <轮次>]` 只读重放聊天轮次，按顺序列出谁被叫到、谁说了什么、总结与结论；主持没回应而落到自动摘要、成员没发言、缺结论都会单独标警告。
- 结果正文走 `GET /api/rooms/:id/artifact?path=...`，只允许房间工作区；文本最多 256KB，图片最多 6MB，其他二进制回退到打开文件/文件夹。

## 常驻承诺（定时）

- 已接线：工作室房间上的 `room.promise`；`work_item` 增加 `promise.tick`；只支持每周/每天、本地时间、一个房间一件。
- 入口：交付卡里的「以后每周也这样」，默认周五 18:00；房间顶部一行显示「说好的、下次、上次」，主操作「现在跑一次」，`⋯` 里「改一下 / 暂停 / 不做了」。
- 到点开一轮普通轮次；这一轮验收通过后自己收口，不用人在应用里点确认。房间忙、暂停或停着就跳过这一期并记下，不排队；启动失败记下并排下一期。关掉应用错过的到期项，下次打开补一次，并在房间说一句「这一期是补上的」。
- 邮件投递：在「改一下」里选「发到邮箱」并填地址，再选「每次都发 / 有变化才发」。先在左下角「你 → 邮箱 → 连接」里填发件邮箱和应用密码；常见服务商的主机、端口和加密按地址自动认（126/163/QQ 要用授权码，不是登录密码）。点「测试」会先保存再发一封测试信，按钮变绿就是通过；认不出的服务商只接常见邮箱，更少见的服务器用 `LODGE_SMTP_URL` / `LODGE_EMAIL_FROM`。配置写在 `~/.lodge/smtp.json`（只有本人可读），密码不回传、不进房间、不进日志；环境变量优先。命令行测试：`npm run smtp:test`。一轮交付后正文优先取文本产物，其次取结论和文件路径；同一轮只发一次，失败重试 3 次。有变化才发时，内容指纹相同就不发，只在房间说一句。
- 只在 Lodge 进程运行时跑；关掉应用不跑，下次打开补一次，没有后台常驻。审批、预算和外部动作门禁照旧；只在工作室。
- 未做：轮次间对比、连续无变化自动停、发现重复后提议、后台常驻。先跑真实一周，记做到率、有用率、想停率、每期成本。

## 影子评审

每间工作室内置一个隐藏成员，不占席位、没有工具。只在被退回、改动大或碰到配置时取一份对照意见；优先扫安全、权限、依赖、隐私和数据风险，不重复验收员的逐行功能评审；只写摘要、理由、风险、缺失证据，按阶段覆盖，不进验收提示词、不改变 PASS/REJECT、不阻塞验收。失败只留一句提示。

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

- 所有阶段通过的房间追加一条记忆，按 `sourceRepo` 归到工作区；同房间不重复写。记忆只存目标、结论、文件路径、退回理由和 commit，不存正文、附件或 `.env`；写入前统一脱敏。
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
- 两个破坏性命令都支持 `--dry-run`：只列出会恢复或删除的备份、数据库和工作区，不动任何文件；先干跑一次再真跑。
- 成对恢复：`npm run data:restore -- --all` 恢复最新数据库和最新工作区归档；也可以 `--workspaces <name>` 单独恢复。目标目录已存在时默认拒绝，`--force` 才覆盖。
- 停止窗口不删数据；退出 app 会停 Lodge 和它启动的基座。不要在共享基座上用空数据目录启动第二个 Lodge：空库首次启动会清掉基座里所有 Lodge 孤儿资源。

## 发布

推送 `v*` 标签时，`.github/workflows/release.yml` 构建 Mac arm64 zip 和 Windows/Linux 安装包，做包内容检查和启动 smoke；Mac zip 校验 ad-hoc 签名并生成 `SHA256SUMS.txt`。没有自动更新，发布后手动下载替换。

## 验证
- 一次构建结束、尤其是走偏之后，运行 `npm run retro:env`：它按严重度列出这次改动的环境缺口（缺测试、缺文档、空白错误、改动面过大、未提交改动），不进入房间角色。

`npm test`、`npm run build`、`npm run test:ui`（Playwright + axe，覆盖首屏、结果卡、目标面板、窄屏暗色、灵动岛视觉基线）、`npm run smoke:electron`（启动真正的桌面壳，建一间示例房、退出、重开）、`npm run prepare:runtimes`、`npm run package:mac:dir`、`npm run smoke:package`（加 `--gui` 会启动打包后的桌面程序并确认窗口渲染）。端到端验证需要 Pi 已登录：新建工作室，执行引擎选 Pi，确认执行官交回结果证据、验收员自己验过并给出结论，验收通过后直接交付。

提示词快照在 `server/crew/fixtures/prompts/`；有意改提示词后跑 `npm run prompts:update`，把 diff 当行为变化审，不要顺手全量覆盖。基座 HTTP 契约由 `server/base.contract.test.js` 钉住，改 `server/base.js` 必须同步改它。

基座响应的形状来自真实 8799：`npm run base:record` 重新录制（只存键名和类型，不存任何 bot、消息或配置值），`npm run check:base` 对比当前基座，字段减少会非零退出。回放测试在 `server/base.shape.test.js`；`smoke:real` 也包含这一步。

真实环境先跑只读冒烟 `npm run smoke:real`：检查 Lodge 8787、基座 8799、基座形状和本机模型路由，不建房间、不调模型；任一不健康就非零退出。macOS 可装每日定时：`npm run nightly:smoke:install -- 09:17`，失败弹系统通知，日志在 `~/Library/Logs/Lodge/smoke.log`；`npm run nightly:smoke:uninstall` 移除。

真实评测也可定时：`npm run nightly:eval` 依次跑真实房间（3 次）、规划、执行和验收探针（5 次，并写探针池），需要 Lodge 8787 和基座 8799 都在、且会真实调用模型；环境不在就跳过模型环节，以 2 退出。验收探针要求 Lodge 用 `LODGE_PROBE_REVIEW_PATCH_DIR=/tmp/lodge-probe-patches` 启动；没开缺陷注入就跳过这一项，并在日报里写明，不算失败。日报写到 `evals/nightly/results/<日期>.md`（不进 git），失败以 1 退出。macOS 安装：`npm run nightly:eval:install -- 03:17`，日志在 `~/Library/Logs/Lodge/eval.log`，失败弹系统通知；`npm run nightly:eval:uninstall` 移除。任务也设了登录时补跑：晚上关机、第二天登录时如果今天还没有日报就补一次，已经有就跳过。它不进 `check:done`：一次几分钟到几十分钟，花真实额度。

长聊天压测用 `npm run soak -- --minutes 30`：按真实总线灌流式增量，输出回合数、消息数和堆内存，不进入 `check:done`。

提交钩子在仓库的 `.githooks/pre-commit`，`npm install` 后由 `prepare` 自动接上，也可手动 `npm run setup:hooks`；它跑完整的 `npm run check:done`（含界面端到端、Electron 冒烟、技能包结构、题库自检、长任务与历史检索基准）。CI 跑同一套但跳过 Electron 冒烟（`npm run check:ci`），桌面壳冒烟在独立的 macOS job；发布流程在 Mac 上跑界面端到端、Electron 冒烟和打包后 GUI 冒烟，Windows/Linux 也跑界面端到端再打包。`check:acceptance` 不只看矩阵里的文件是否存在，会实际执行矩阵链接的 Node 单测；视觉基线在 `e2e/visual.spec.mjs` 和 `e2e/island-visual.spec.mjs`（Mac 录基线，Linux 跳过），首屏、长列表和并发读取预算在 `e2e/budget.spec.mjs`。

## 评测

- `npm run eval:rooms` 评交付：真实建房、真实成员、真实验收，再由题库外的独立脚本核对产出。调用真实模型，不进入 `npm test`。评测房只会替 `/tmp` 下的清理自动拍板，其他外部动作仍停下等真人；无人值守时等不到就按没通过记。
- 固定题覆盖切图、改稿和弱检查下的验收；每条记通过、返工次数、墙钟和成本，可换引擎或模型交叉跑。
- `--memory off,seeded` 对照「有没有工作区记忆」；`--baseline` 和上一次同题结果比通过率、返工、墙钟和成本。
- `npm run eval:rooms -- --validate` 只检查题库：原样必须不通过；它已进 `check:done`。题库细节见 `evals/rooms/README.md`。
- `npm run eval:history-bench` 在 5k 条消息上量历史检索的 p50/p95，不调模型，已进 `check:done`；细节见 `evals/history-bench/README.md`。
- `npm run eval:verifier-probe` 在验收副本里注入已知缺陷，同时跑一个合格对照，报抓出率、误放率、误拒率和成本；调用真实模型，按夜间跑，不进 `check:done`。细节见 `evals/verifier-probe/README.md`。
