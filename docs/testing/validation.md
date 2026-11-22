# 真实运行记录

这份文件只记自动测试覆盖不到、实际跑过的路径。自动能力仍以 [acceptance-matrix.md](acceptance-matrix.md) 为准。

## 2026-11-21 · 真实三阶段项目

- 仓库：`/tmp/lodge-long-project-20261121`，一个真实 git 仓库；项目根房 `room-b1980650`，三段分别是 `room-b1980650` → `room-6f0bc53c` → `room-5558b85f`。
- 目标：先做 hello()，再做 farewell()，最后做 `bin/greet.js` 命令行；每段都是一间真实工作室。
- 结果：三段全部 `complete`；项目轨迹页显示 3 个阶段、当前第 3 阶段，三段都是「已交付」。
- 证据：最终工作副本 `/Users/wangxuguang/CrewWorktrees/5558b85f/worker` 的 `npm test` 6/6 通过；`node bin/greet.js 千寻` 输出 `Hello, 千寻!` 和 `Goodbye, 千寻!`；最终提交 `d4fc5b5`。
- 用量：阶段 1 4 回合、178,102/1,353 tokens、$0.1147（partial）；阶段 2 5 回合、275,641/2,287、$0.1357（unknown）；阶段 3 6 回合、289,270/3,380、$0.1379（unknown）。已回报合计 $0.3882。
- 厂商：规划师和执行官记录为 `claude` / `claude-sonnet-5`；验收员记录为 `pi` / `deepseek/deepseek-flash`。本机 `claude` CLI 仍走 DeepSeek 端点，界面标签不等于真实厂商。
- 现场 bug：阶段 3 验收员 PASS 时调用了 gate 但漏了 `outsideDiff`；MCP 工具会拒绝，但内部 `gateSubmissionOf` 仍把调用当成有效 PASS，房间卡在 `signoff`，岛上只显示“去处理”但没有可操作卡片。为完成本次真实项目，按人工确认 `force` 收了阶段 3。
- 修正：`judgmentFromGate` 现在和 MCP 入口一样要求 PASS 带 `outsideDiff`；无效 gate 调用回落到文本判定，并补了 `shared/gate.test.js` 回归。
- 本次项目保留在 Lodge 里供查看，未清理；`/tmp` 仓库和 CrewWorktrees 也保留。

## 2026-11-21 · 全量 dogfood（技能收敛后）

- 环境：Lodge `http://127.0.0.1:8787`，基座 `http://127.0.0.1:8799`。本机 `claude` CLI 走 DeepSeek anthropic 端点，模型 `deepseek-v4-pro`；评测报告记录为 `auto`，没有把 engine/model 写死。
- 自动：`npm test` 1133 通过；`npm run test:ui` 12 通过；`check:docs`、`check:acceptance`、`check:regressions` 全部通过。
- 房间评测：`npm run eval:rooms -- --validate` 三个题的独立尺子都 ok；`verify-catch` 的自带验收原样就绿，是弱检查。`npm run eval:rooms` 3/3 PASS，0 返工，p50 36,995ms，max 264,546ms，合计 $0.4626（partial，未知 0 次）。逐题：revise-tone 27,898ms / $0.1363；slice-sheet 264,546ms / $0.1644；verify-catch 36,995ms / $0.1619。三次都 delivered、verdict pass、独立检查 ok。
- 规划评测：`npm run eval:planning` 3/3 PASS，100 分，p50 6,376ms，2 个决策问题，验收命令均为 `npm test`。
- `npm run eval:chat` 仍然跑不通：脚本读 `room.seatBots`，公开状态已剥掉成员 ref，停在“房间没有席位 bot”，没有进入模型回合。
- 评测房已清理：三条运行的 `cleanupErrors` 都为空。
- 现场 bug：`verify-catch` 执行回合开始后，侧栏仍显示“验收员在看”。根因是 `busyMembers` 采样的 working 标记晚于工具活动；旧证据触发了 review 投影。修正为把当前 running 队列和最近 2 分钟的工具活动视为“这一回合还在跑”，只压掉基于旧证据的 review/rework，不压人的交接、阻塞和超时。新增 `attention.test.js` 回归。
- 仍未强制制造：真实合并冲突留给人、退回指定步骤、自动重做预算耗尽、规划师 `submit_decision` 返工路径；这些继续由单测覆盖。

## 2026-11-18 · MCP gate

- 房间：`room-47b3f3ac`「MCP gate 验收 2」
- 目标：在仓库根目录创建 `gate-check.txt`，内容为 `gate-ok`
- 过程：目标对齐 → 执行官写入 → 验收员复核
- 结果：三步全部通过；验收员实际调用了 `lodge_gate_submit_verdict`
- 证据：verdict 的 `meta.judgment.source` 为 `gate`，`decision` 为 `pass`，`meta.judgment.reason` 来自工具入参；没有权限拒绝
- 未触发：规划师的 `submit_decision`（本轮验收直接 PASS，没有进入返工/交给人）

## 2026-11-18 · 基座清理

- 初始基座：100 个 bot、110 个群；其中 42 个 bot、58 个群属于已从 Lodge 数据中清除的旧房间
- 执行 `npm run gc:base -- --apply` 后：58 个 bot、52 个群；当前房间和另一个应用的 7 个 bot 保留
- 新建探针 bot 成功，`lodge_gate` 在探针上是 `on:true`，探针随后删除

## 2026-11-18 · 原生换身体

- 用探针 bot 验证 `patchMemberBot`：同一 bot 的 `threadId` 不变
- 换模型/设定后 `lodge_gate` 仍为 `on:true`
- 探针 bot 随后删除

## 2026-11-18 · 模式切换

- 工作室 → 聊天室：`room-47b3f3ac` 切换后成员、基座 bot 和 `threadId` 全部不变，新建的 `LodgeHost47b3f3ac` 加入同一个房间群；再切回工作室，规划师收到对齐提示并回话
- 聊天室 → 工作室：`room-9893a8bc` 不选角色时返回“先选一位成员做规划师”；指定甲为规划师、丙为验收员后，角色与权限按定义更新，三个成员的 `threadId` 不变，阶段重建为“目标对齐 / 交接主题 / 验收与结论”
- 界面：切换弹窗正常开关；缺角色时出现规划师、验收员两个下拉，规划师选项会自动从验收员候选中排除；确认后请求带上 `plannerId`、`verifierId`

## 2026-11-18 · 聊天室灵动岛

- 聊天室和工作室共用同一个目标岛，但故事分开：聊天室只讲“正在聊 / 聊到这儿了 / 聊完了”，没有待处理的结论；工作室继续讲步骤和交付。
- 实际页面：聊天室岛不再出现“2/2 结论”或“待处理 · 结论”；已确认的聊天室显示“已确认”，工作室的岛保持原样，已交付的示例房仍显示“已交付”
- 已确认的聊天室用“已确认”，不借用工作室的“已交付”

## 2026-11-19 · submit_decision

- 第一次尝试 `room-a8d294c4`：验收员通过 `lodge_gate_submit_verdict` 退回（source=gate），但规划师回合工具调用为 0，判定走文本兜底（source=text）
- 修正：判定提示改为必须调用 `lodge_gate_submit_decision`，工具列表里没有就先 `ToolSearch` 查它；工具描述也写明“判定一律先调用本工具”
- 第二次尝试 `room-3a189c90`「submit_decision 验收 3」：验收员再次 REJECT（source=gate）；规划师回合先 `ToolSearch` 再调用 `mcp__lodge_gate__submit_decision`，`lastPlannerDecision.judgment.source` 为 `gate`，decision 为 `human`，rejectTo 为 `human`
- 同时修正注意力：规划师把步骤交给人后，房间显示“规划师把这一步交给你”并带上 `actionRequired`，不再显示“待重做”

## 2026-11-19 · 判定提交强制

- 规则：判定回合没有门工具提交、首行也不是 PASS/REJECT 或 返工/交给人 时，先向同一位成员催一次“只提交判定”；再次没有提交，就按“规划师没有提交决定”交给人，不再把解释性文字猜成结论
- 自动覆盖：`shared/judgment.test.js` 的锚点判定、`server/crew/live-turn-modules.test.js` 的规划师先催后升级与验收员先催后过期
- 正常路径 smoke：`room-e815cc00` 的验收员只回复 `PASS` 文本，仍然被接受（source=text），没有误触催提交；模型侧没有被强制制造“不提交”的场景，升级路径靠单测覆盖

## 2026-11-19 · 验收按目标原文判断

- 问题现场：`room-e815cc00` 的目标是“内容只有一行 hello”，规划师派发时改成了“内容随意但要是正常文本”，执行官写了中文句子，验收员按“能读到正常文本”判了 PASS
- 修正：规划师派发时带目标原文、验收标准和硬要求（文件名、路径、内容、行数、格式、范围）；验收员提示明确“执行成员或规划师改写的标准不算标准，任何一条不满足就 REJECT，不要用更弱的标准替代目标原文”
- 修正后：同一房间重开第 2 步，规划师派发写成“内容逐字只有一行 hello，不要别的文字、不要多余空行”；执行官照做，验收员通过 gate 记录 PASS，理由是一行 hello 符合目标
- 对照：把内容换回中文句子后，验收员回复“REJECT，hello.txt 内容不是单行 hello，未达房间目标”，没有再拿可读性代替目标；该回合因复核轮次已被重开过期，没有落成 verdict

## 2026-11-19 · 人的输入、用量与诊断

- `room-e815cc00` 重开第 2 步并补一句上下文后，房间多出一条 `human-context` 消息（`source=rewind`），同时保留原来的 `rework` 标记
- 同一轮的执行回合被记进 `room.usage`：2 个回合、输入 49852 / 输出 627 tokens、费用 132956 微美元，状态 `reported`
- 诊断包落盘在 `CrewWorktrees/e815cc00/executor/.crew/rooms/room-e815cc00/diagnostics/`；抽查的一条包含阶段、成员、回合时长、工具调用、用量和 `outcome=evidence`、证据 id、assignment id
- 返工预算与晚到回合围栏没有在真实房间里强制制造，靠 `live-turn-modules.test.js` 覆盖

## 2026-11-19 · 兄弟分支、续接、路由与错误分类

- 兄弟分支：重试单个执行成员时，同一阶段被取消的兄弟分支会一起复活；单测覆盖
- 续接规则：重启后先看这个成员有没有产生过工具活动；有就只发“继续并汇报”，没有才允许重开一次，第二次仍零产出就停下交给人；单测覆盖
- HTTP 路由从 `server/index.js` 抽成 `server/http.js` 的工厂，新增 HTTP 层扫描：只有 2xx/3xx 才计入覆盖，4xx 只算“到达”；真实服务重启后 `/api/state`、`/api/health` 返回 200，未知接口返回 404
- 错误分类补了 forbidden/unavailable/upstream（403/503/502），并支持附加字段；HTTP 扫描覆盖

## 2026-11-19 · 工具面与不可信内容

- 新建 `room-afdf7a2b` 后检查真实基座成员：规划师和验收员的 `toolScope.deny` 只有 `mcp:agents:*` 并且挂 `lodge_gate`；执行官的 deny 多了 `mcp:lodge_gate:*`，没有 gate MCP；影子评审同样隐藏 agents
- 验证后归档并删除该房间，基座群和 bot 都已回收
- 验收与影子评审的外部内容现在先去掉零宽/双向/控制字符，再按字符预算截断（证据 4000、输出 6000、diff 12000），由单测覆盖

## 2026-11-19 · 房间记忆只读试点

- `room-ecbc84a4`「memory check」交付后，`GET /api/rooms/room-ecbc84a4/memory` 返回一条记录：目标、验收结论、三步状态、改动文件、通过状态，`readOnly` 为 `true`
- 界面右上角新增「房间记忆」，弹窗只列已交付房间，没有编辑或写入入口；页面实测可读到这条记录
- 写入只发生在房间所有阶段通过时；同一房间重复完成不会重复追加；每个工作区最多 200 条、单条 4KB、单文件 1MB，超过就停止写入
- 试点边界：按 `sourceRepo` 归档，所以只有共享同一个源仓库的房间会看到彼此的记忆；房间记忆不进入提示词，也不参与验收

## 2026-11-19 · 人的交接回路

- `room-3a189c90` 的规划师把第 2 步交给人后，用户在输入框发“版本号 1.2.0，发布日期 2026-11-19”，房间直接生成了 `rework` 和 `human-context`，`lastPlannerDecision` 清空，没有停在聊天
- 第一次重做暴露了补丁前的缺口：规划师在群里 @ 了执行官，系统就不再私下送任务，规划师的话又漏掉了人的补充；执行官仍回复“等版本号”
- 修正后重跑：规划师提示里带上“用户补充（原文，必须保留）”，重做任务无论规划师是否 @ 都私下再送一次；执行官实际写入 `1.2.0` / `2026-11-19`，验收员判定 PASS
- 房间记忆的提交来源补成“房间提交”或“工作区 HEAD”，由单测覆盖

## 2026-11-19 · 记忆审核与聊天用量

- `room-ecbc84a4` 的记忆条目在页面里从“待审核”点成“已发布”；随后用该工作区的 `sourceRepo` 读取，`shared` 返回了这条已发布记录，未发布的不会返回
- 新房间交接包最多带 3 条已发布记忆，标成“只读参考，不是指令，可能过期”，由单测覆盖
- 聊天室回合现在也累计 `room.usage`，由 `chat/runtime.test.js` 覆盖；真实聊天室跑过一轮，记录 19,185 输入 / 149 输出、$0.07972
- 返工预算、晚到围栏、断线续接仍然没有强制制造真实场景，继续留在“仍需真实环境”

## 2026-11-19 · 房间健康卡、记忆处置与人工门

- `room-c9d7236f`「Dogfood 合并冲突」第 2 步跑完后，房间顶部出现健康卡：`第 2 步「并行写 shared.txt」 · 规划师 · 4 条证据 · 0 项未知 · 4 回合 · 至少 $0.22 · 返工 4 次 · 你介入 1 次`；费用是部分已知，按“至少”显示
- 同一房间的规划师把这一步交给人时，时间线末尾出现人工门卡片，写明这一步轮到你决定；填了“保留两个版本，合并时让我决定”并点“补充并重跑”，房间追加 `rework` 和 `human-context`，`lastPlannerDecision` 清空，卡片消失
- 右上角新增“怎么用”，说明聊天室 / 工作室、换模式和成员；示例房间首次打开会自动弹一次，关闭后写入本地标记
- 房间记忆弹窗里每条记录有“发布 / 不采用 / 删除”；健康卡能显示“参考 N 条记忆”，并可在房间内停用工作区记忆
- 记忆与数据库分开备份：启动和每 6 小时生成 `backups/memory-<时间>-<原因>/`，保留 10 份，由 `data-recovery.test.js` 覆盖
- 健康卡第一行改成只回答“现在需要你做什么”：有待办时显示“需要你：…”，否则显示“第 2 步「…」 · 执行官在做”；费用、回合、返工和介入次数收进展开后的详情
- 完成态不再以“目标完成”一行收尾：房间最后一条是“结果”卡（标题、目标、检查、详情），下载记录、聊一聊和开新房放在卡下；卡片组件此前已有单测但没有被渲染，这次接进工作室时间线
- 房间列表曾改成“需要你 / 正在做 / 已交付 / 已归档”分区，后来按用户要求恢复为一条平铺列表：待办在前、最近其次、已完成在后，只有“已归档”单独分组；只有需要你的房间显示状态点和状态词
- 没有房间时不再自动打开示例房，而是停在“今天想完成什么？”：写下目标进入建房，示例改成入口链接
- 工作室主时间线不再显示工具步骤和系统旁白：当前在做什么由岛和输入行回答，过程留在证据和交付记录里
- 验收进度文案从“验收员在看 · 已回 0/1”收成“验收员在看”，不再把内部计数放在待办里
- 侧栏底部的占位“你”已移除，房间列表成为侧栏的最后一块内容

## 2026-11-19 · 产品化减法

- 前门：空数据下首页只留一个问题、一个输入框和一个示例入口，首次使用不显示空侧栏；写下目标按开始就直接建房，文件夹不选也能开工（Lodge 自备工作区），失败才退回建房对话框
- 建房弹窗里工作文件夹变成可选，空着显示“不选 · 用 Lodge 的工作区”；成员下面用一句“一人规划、一人执行、一人检查”解释三个角色
- 房间工具收进右上角的“⋯”：调整步骤、切换房型、房间记忆、怎么用都在菜单里，第一屏只留岛、状态和对话；实测点菜单项会打开对应弹窗并收起菜单
- 真实 API 验证过零文件夹建房：`room-46618e9f` 的源目录落在 `~/CrewWorkspaces/room-46618e9f`，三位成员自动配好；验证后已归档并删除
- 房间：进行中的房间第一屏是岛、一句话状态和对话，没有工具日志；交付后的房间最后一条是“结果”卡，费用从卡面收进“详情”
- 建房：目标、文件夹、成员摘要和“更多选项”在同一屏；成员模型和验收细节收在折叠里
- 判定卡标签从 PASS/REJECT 改成“通过/退回”，和界面其余中文保持一致
- 侧栏底部的占位“你”已移除；影子评审在界面上仍叫“影子评审”
- 隔离验证时用空数据目录启动了第二个实例，触发了基座孤儿清理（24 个群、27 个 bot）。当时只看公开状态里的成员，`ref` 已被投影剥掉，不能证明基座线程还在；重启后有旧 dogfood 房报“engine 里没有 planner 成员线程”。新房间不受影响，旧房间的基座线程无法恢复。这条操作已写进运行手册，避免再犯

## 2026-11-19 · 零准备全流程 dogfood

- 从 API 走前门同款参数建房：目标 + `verify:manual`，不选文件夹；`room-d0f79f47`「Dogfood 零准备 3」的源目录自动落在 `~/CrewWorkspaces/room-d0f79f47`
- 第一次跑通时暴露三个问题并修掉：规划师对齐回合结束后“目标对齐”仍停在待确认、没有界面动作；顶层工作室跑完全部步骤后 `state` 仍是 `active`，交付卡和记忆收不了尾；交付卡的人工验收位显示“结果已经好了，等验收员复核”而不是验收结论
- 修复后重跑：对齐自动通过，执行官写入 `hello.txt` 并跑 `test -f`，验收员 PASS，房间进入 `complete`，交付卡显示“验收：…符合目标”，提交 `b36a401`，记忆写入待审核
- 这一轮 5 个回合、168,358 输入 / 1,855 输出；供应商没有回报费用，房间按“费用未知”记录
- 已知边界：人工验收模式不生成命令证据，未跟踪文件也不进阶段改动清单，所以交付卡的文件列表为空，结果由验收结论说明

## 2026-11-19 · 从 0 开始的全场景 dogfood

清空 `.data`、`~/.openmausbot/*`、`~/CrewWorkspaces/*`、`~/CrewWorktrees/*` 后重建。空数据启动基座时发现 CLI 环境没带过来，`claude` 报 `Not logged in`；用带 `~/.claude/settings.json` 环境的启动器重启后恢复。

- 零准备：从首页写下目标直接建房（`room-621f4922`），5 回合、283,898 输入 / 2,034 输出、$0.282，交付 `318630a`，记忆写入待审核
- 带文件夹与检查：`room-46984927` 在 `/tmp/lodge-dogfood-project-1` 生成 README.md，验收命令 `test -f README.md` 退出码 0，改动文件被交付卡识别
- 聊天室：`room-04929b57` 六条发言后给出结论，6 回合、$0.355；切到工作室再切回聊天室成功，成员和消息保留
- 并行与人工门：`room-182d6c7f` 两位执行官各写一版，第一次只有 alpha 被退回，重做后两条分支都交付，验收员最终 PASS；中途拒绝了一次验收员的网络审批，16 回合、$1.309
- 记忆引用：批准 `room-46984927` 的记忆后，新建 `room-2b22bc6a` 时 `sharedMemory` 带上了这条已发布记录
- 子房间：父房 `room-687eea4d` 创建子房 `room-cb844884`，子房结论被父房用进 `parent.txt`，两间房都进入已交付；父房允许了一条本地网络审批
- 归档删除：删除聊天室后基座少了 4 个 bot、4 个群

这一轮抓出并修掉：

1. 规划师对齐回合后“目标对齐”停在待确认且没有界面动作 → 无未答问题时自动确认
2. 顶层工作室全部阶段通过后 `state` 仍为 `active`，交付与记忆收不了尾 → 最后一步通过即收尾并标记 `complete`
3. 成员补一句无工具、无改动的回复会让人工证据作废，子房因此卡住 → 只有真的动过工具或产出文件的回合才推进凭证下限
4. 规划师安排的并行重做只送进一位执行成员 → 按阶段执行成员逐个送进各自工作副本
5. 聊天刚出结论时切回聊天室，基座会回 409“还在收尾” → 文案改成“几秒后再切换”，而不是直接抛 base 错误
6. 交付卡把“结果已经好了，等验收员复核”当成验收说明 → 改为显示通过的验收结论

仍未在真实房间强制制造：合并冲突留给人、退回指定步骤、自动重做预算耗尽、规划师 `submit_decision` 返工路径。

## 2026-11-19 · 第二次从 0 dogfood（旧数据不清兼容）

再次清空 `.data`、基座数据和两个工作区目录，用带 CLI 环境的启动器重启基座，从 0 重跑：

- 零准备 `room-110b500f`：5 回合、$0.294，交付完成
- 检查 `room-75bedc2f`：6 回合、$0.402，验收命令与改动文件都进交付卡
- 记忆引用 `room-5d8e3d20`：批准上一间的记忆后，新房创建时带上 `sharedMemory`，6 回合、$0.434
- 子房间：父房 `room-d1728e2e` 9 回合、$1.170，子房 `room-4e67e05c` 5 回合、$0.372，两间都交付，子房结论被父房采用；子房不再卡在“验收通过但没有签字”
- 聊天室与模式切换：先切工作室、再切回聊天室，成员和消息保留；刚结束的一轮会回“聊天室刚结束，还在收尾；几秒后再切换”，重试即可；删除聊天室后基座少 4 个 bot、4 个群
- 并行 `room-51fcb522`：两位执行官都产出 alpha/beta，真实产生 `needs: merge` 和 `shared.txt` 冲突文件，停在“合并冲突”；房间没有直接处理冲突并继续的入口，只有退回重做。21 回合、$2.009

这一轮确认修复仍然有效：对齐自动确认、顶层收尾、子房自动签字、基座回放的子房通知不再以“你”的气泡出现在时间线。

新的首要缺口：**真实合并冲突没有“打开冲突目录 → 人解决 → 继续验收”的闭环**；另外基座是全局单租户，任一房间的 bot 在跑时，模式切换会被全局挡住，界面只能提示等它结束。

## 仍需真实环境

- 规划师通过 `submit_decision` 的“返工”路径（本次真跑的是“交给人”）
- 多成员并行时某个分支取消后重跑，兄弟分支是否完整恢复
- macOS 打包、ad-hoc 签名和桌面外壳

## 2026-11-19 · 合并冲突人工闭环与结果优先

- `room-e2764cee`「Dogfood 冲突闭环」：两位执行官并行改 `shared.txt`，集成时在阶段 1 产生冲突，房间停在合并冲突上
- 人在 `/Users/wangxuguang/CrewWorktrees/e2764cee/integration` 里保留 `alpha` + `beta`，提交 `9fcffe5`，调用 `POST /api/rooms/room-e2764cee/resolve-merge` 继续
- 验收员 PASS，理由写明“冲突已由人合并成一条提交”；房间完成，交付提交 `1fdd4f0`；从继续到 PASS 约 13 秒
- 用量：11 个回合、约 $1.00；上一轮同类冲突场景 21 个回合、$2.01
- 界面：交付页默认只有结果卡和岛，岛只写“已交付”；内部路径、费用、版本、模型自查折进“详情”，规划对话和阶段过程折进“工作记录”；`ui/src/room/studio/transcript.test.js` 覆盖完成/进行中两种视图
- 自动覆盖：`server/crew/workspace-git.test.js` 增加 `keepConflict` 保留冲突现场；`server/crew/service-merge.test.js` 覆盖解决后继续、未解决/未提交/残留标记/无冲突四条拒绝路径；`ui/src/room/studio/merge-conflict.test.js` 覆盖解决卡；`ui/src/room/studio/transcript.test.js` 覆盖结果优先
- Pi：CLI 装在 `~/.local/bin` 后重启基座，`/api/instances` 返回 available + authenticated；临时房间 `room-c0b11531` 的 Pi 成员实际回复后归档删除

## 2026-11-19 · 只读研究试点（航班）

- 目标：查 2026-12-20 上海到东京的三个直飞选项，带价格、时刻、退改规则和链接
- 来源：Google Flights；往返 12/20–12/24，单程模式对同一路线返回“未返回结果”
- 结果：四个直飞选项，往返含税价 09:35 ¥3,690、09:00 ¥3,739、13:05 ¥4,644、13:40 ¥5,076
- 发现：09:00 选项在约 80 秒内从 ¥4,178 变成 ¥3,739；结果页不提供票价规则，只提示可能另付行李费；没有单航班深链
- 证据：`https://www.google.com/travel/flights?hl=zh-CN&curr=CNY&q=flights%20from%20SHA%20to%20TYO%20on%202026-12-20`；截图在本地 `/tmp/lodge-research/flights-final.png`，未入库
- 第二来源 Trip.com：同一日期往返共 85 个结果，最低 PVG→HND ¥2,835（春秋，21:10 起飞、次日 01:05 到），ANA PVG→HND ¥3,094，东航 PVG→NRT ¥3,152；链接 `https://www.trip.com/flights/shanghai-to-tokyo/tickets-sha-tyo/?ddate=2026-12-20&rdate=2026-12-24&triptype=rt&locale=en-US&curr=CNY`
- 来源差异：Trip.com 的最低价来自浦东和红眼航班，不能和 Google 的虹桥白天直飞直接比；两个来源都没有在结果页给出退改规则，Trip.com 只显示行李
- 结论：只读查价和时刻可行且快，从打开到三条结果约 1 分钟；两个来源的价格不能直接横比，必须先统一机场和时段；退改规则和可执行下单不能只靠搜索结果，需要出票页或航司规则；暂不把浏览器订票产品化

## 2026-11-19 · 工作室研究 dogfood（曼谷→太原）

- 目标：2026-11-25 曼谷（BKK/DMK）到太原（TYN）单程，三个候选，带起降、时长、经停、含税价、链接和查询时间；只查不下单
- 聊天室 `room-96eaa993` 直接拒绝 WebSearch：“聊天室只放行只读工具”；按提示改建工作室 `room-f1c6fcdf`
- 工作室里规划师派活后，研究员先后请求 WebSearch、WebFetch、curl、npm 安装和 headless Chrome 共 9 次审批；拒绝 `rm -rf /tmp/chromeprof2`，允许安装 puppeteer-core
- 研究员自己写了 puppeteer 脚本抓 Google Flights，选择器 `li.pIav2d` 等待 45 秒超时，没有抓到结果；没有写出 `flight-options.md`，叫停后房间停在“没有可验收的交付改动”
- 用量：2 个回合，输入 72293 / 输出 176 tokens，费用 56032 微美元（partial）
- 界面 bug：岛和侧栏显示“有一个操作要你点头”，工作室时间线却没有审批卡；已让 `StudioTranscript` 渲染 `ApprovalCard`，浏览器验证能看到“可以做/先别做”，`ui/src/room/studio/transcript.test.js` 覆盖
- 结论：产品目前跑不通这个场景。缺的不是模型，而是受控的浏览器工具、按任务一次的审批和结果规范；在此之前不要把浏览器订票当成已支持能力

## 2026-11-19 · 受控浏览器（chrome-devtools MCP）

- 目标：2026-11-25 曼谷到太原单程，三个候选，带起降、时长、经停、含税价和链接；只查不下单
- `room-05640dfc`：执行成员 `研究员` 持有 `chrome-devtools` grant；基座 MCP 健康检查 `ok`，实际调用了 `list_pages`、`navigate_page`、`take_snapshot`、`new_page`、`select_page`
- 输入类工具被关掉：一次 `click` 调用返回 `ok:false`，没有代替人点击
- 结果写进 `flight-options.md`：海航 19h35 THB 4,615、南航 18h THB 5,420、深航 16h10 THB 7,460；另有 08:10 南航 8h35 THB 10,175
- 用量：3 个回合，输入 773500 / 输出 7181 tokens，费用 401146 微美元；房间完成，交付提交 `1fb9d737`
- 审批：每个 MCP 工具调用仍需点一次；这是下一步要收敛的房间级授权
- 界面：工具运行时显示一行“执行官 正在运行命令 17s ›”，命令折叠，三点动效；有最近工具活动时不再同时显示“等待规划师”
- 自动覆盖：`server/browser-mcp.test.js`、`server/crew/roster.test.js`、`ui/src/room/studio/working-line.test.js`、`ui/src/room/studio/transcript-model.test.js`

## 2026-11-19 · 房间级浏览器权限

- `room-1b2f4daf` 建房时选“房间免确认”；房间记录 `roomAccess:"allow"`，执行官自动获得 `chrome-devtools` 能力
- 研究员用 `navigate_page`、`take_snapshot` 打开 `https://example.com`，把标题 `Example Domain` 写进 `title.txt`；没有产生任何审批卡
- 用量：4 个回合，输入 443024 / 输出 1930 tokens，费用 268522 微美元；房间完成，交付提交 `4c119ba4`
- 两种权限：每次确认（每个外部动作都问）、房间免确认（只放行浏览器、搜索和抓取这类只读研究；命令、文件和付款仍逐次确认）
- 自动覆盖：`server/crew/approval-bridge.test.js` 验证浏览器工具自动放行、非浏览器动作仍挂卡；`ui/src/room/studio/create.test.js` 验证请求带上房间权限

## 2026-11-19 · 房间权限可改（已被同日「只读标配」取代）

- `room-1b2f4daf` 右上角只在全权时显示“免确认”状态，点开弹框说明“每次确认 / 房间免确认”两档
- 从房间免确认切到每次确认后，`roomAccess` 变回 `ask`；保存后弹框关闭
- 再切回房间免确认，房间记录和系统消息同步更新；`POST /api/rooms/:id/set-browser-access` 由当时的 `server/crew/service-merge.test.js` 覆盖

## 2026-11-19 · 浏览器成为每个成员的只读标配

- 建房不再有「允许查公开网页」勾选，也没有房间权限；建房和加成员时自动给每个人挂 `chrome-devtools` 只读 grant。
- 只读研究（浏览器、WebSearch、WebFetch）由系统直接放行；命令、写入、付款仍逐次确认；审批卡只留「允许 / 拒绝」。
- 规划师和验收员只允许这一种只读浏览器 grant，其他外部工具仍由 roster 校验拒绝。
- UI 的权限入口、`set-browser-access` 动作和房间级审批按钮已删除；`shared/room-access.js` 只保留工具判断和 grant 判断。
- 自动覆盖：`server/crew/room-access.test.js`、`server/crew/roster.test.js`、`server/crew/approval-bridge.test.js`、`ui/src/room/studio/create.test.js`、`ui/src/approval-card.test.js`
- 本次没有在真实 Chrome 上重新建房跑端到端；1004 项测试、构建、文档与验收门禁通过。

## 2026-11-19 · 工作区记忆入口

- `GET /api/workspace/memory?path=/tmp/lodge-dogfood-project-3` 返回 1 条记忆，目标为并行冲突房的目标，说明按 `sourceRepo` 归档的预览接口可用
- 建房选择工作文件夹后，只有这个文件夹已有记忆时才显示“这个文件夹有 N 条已交付记忆 · 查看”；点开可以发布、不采用或删除
- 入口只在选文件夹之后出现；零准备房间没有共享工作区，不显示
- 自动覆盖：`server/crew/memory.test.js` 覆盖工作区归档与发布/删除；`server/http-coverage.test.js` 覆盖 `GET /api/workspace/memory` 和 `POST /api/workspace/memory/review`

## 2026-11-20 · 全量真实 dogfood

- 房间评测 `eval:rooms`：真实模型、临时 fixture 仓库、外部尺子，`revise-tone` / `slice-sheet` / `verify-catch` 3/3 通过，0 次返工，p50 约 52s，费用约 $0.46；再加跑 `slice-sheet` 三次均通过
- 规划评测 `eval:planning`：修掉 runner 仍按旧参数把 engine 当 probe 传的断链后，3/3 通过，why 一行 3/3，p50 约 6.3s
- UI 端到端：修掉灵动岛 `z z z` 可见文本不在可访问名里、新建房间入口改成加号菜单后两条旧用例、以及草稿用例与示例房发消息的先后依赖；12/12 通过
- 真实厂商：`claude` 实例实际请求发往 DeepSeek 的 anthropic 端点（`deepseek-v4-pro` / `deepseek-flash`），界面上的实例名不代表厂商；`pi` 同时可用
- 发现并修：同一回合从群聊和成员线程各重放一次时会落下两条相同证据；证据按“同一步同一位成员两分钟内同文只留一条”去重，时间线只留更完整的聊天副本
- 发现并修：工作室交付后的“聊一聊”只带回执文字，聊天成员读的是源仓库；回执新增 `paths`，聊天室改读工作室交付副本，才看得到成果
- 仍未跑通：`eval:chat` 依赖 `room.seatBots`，公开状态已剥掉成员 ref，脚本报“房间没有席位 bot”；需要内部取数入口后再跑
- 全程 1116 项单测、构建、文档与验收门禁通过

## 2026-11-21 · 长期工作室两轮与旧链清理

- 模型换成「工作室长期存在、轮次独立」：`room.state` 只保留 `idle/active/paused/stopped`，一轮完成回到 `idle`；`work_round` 保存目标、计划、阶段、门、决策和完成信息；消息与 assignment 带 `work_round_id`。
- 项目改为轮次分组，不再使用 `nextRoomId` 房间链；项目页按轮次列出，开下一轮留在同一工作室。
- 旧 `followup` 路由和新房间 builder 删除，改为 `POST /api/rooms/:id/rounds`；`phase`、`continuation`、`generation`、`nextRoomId` 和旧项目字段不再写入。routines/subrooms 入口停用，旧数据直接清掉，没有迁移或兼容 shim。
- 真实 8787 接口验收：`room-c92d87d2` 在同一工作室完成两轮（`round-1d91f155`、`round-b001cf8f`），两轮都 `completed`，工作室最终 `idle`，项目 `project-c92d87d2` 下 2 轮。验收用 `force accept` 走通轮次状态，不是模型真实交付。
- `npm run check:done` 通过：单测 1140、UI 端到端 16、构建、文档、验收 83 项、回归 2 项。
- 当时未跑：`eval:rooms` 的真实模型两轮交付；旧轮只读详情页（已在下一节补上）；routines/subrooms 后续以轮次重建。

## 2026-11-21 · 旧轮只读与输入条三态

- 项目页和工作室「轮次」都能打开已结束的一轮；`GET /api/rooms/:id/rounds/:roundId` 返回该轮房间视图和消息，按 `work_round_id` 隔离。真实数据 `round-1d91f155` / `round-b001cf8f` 分别 4 / 5 条消息，不串轮，交付可重算，未知轮次返回 404。
- 输入条按 Claude Code 收敛：空输入不显示发送，有文字出现返回箭头，回合在跑时变黑色方块；方块在回合结束、等人时自动消失，只认真实 busy / queue / chat 运行，不靠最近两分钟活动。
- 方块调用 `POST /api/rooms/:id/interrupt`：只取消当前回合和未终态交接，房间保持 `active`，不写 `pauseReason`；房间级 `/stop`、暂停提示和不可达的确认弹窗删除。
- 自动覆盖：`server/crew/service-lifecycle.test.js`、`server/crew/store-rounds.test.js`、`ui/src/composer.test.js`、`ui/src/room/stop-reply.test.js`、`e2e/project.spec.mjs`。
- `npm run check:done`：单测 1142、UI 端到端 18、文档 7、验收 85、回归 2。
- 未跑：用新停止键真实中断一个模型回合；当前验证是接口状态和等待态 UI。

## 2026-11-21 · 内核重写：轮次收口、持久队列与状态统一

- 内核按「新规则、旧管道」重写：新增 `shared/room-status.js`、`server/crew/kernel/round.js`、`server/crew/rounds/lifecycle.js`；房间、轮次、消息和队列仍用现有 SQLite 表，schema 升到 v3。
- 轮次状态补齐：`planning/active/completed/rejected/failed/superseded/stopped`。开始、完成、停止、退回、失败、作废统一清 `activeRoundId`、写 `lastRoundId`、房间回 `idle`；`stop-round`、`fail-round`、`supersede-round` 路由可直接调用。
- `startWorkRound` / `finishWorkRound` 把轮次、房间指针和事件放进同一事务；完成失败不会只写一半。重复完成用 `idempotency_key` 返回原结果。
- 空闲消息不再消失：`work_round_id=NULL` 是房间级消息，当前视图会带上；旧轮详情仍只读该轮。消息和 assignment 的轮次隔离测试保留。
- 运行时释放：`studio/runtime.detach` 调 `turns.dispose`，清 stage timeout、自动重做等待和 planner nudge；完成、停止、归档、删除、开下一轮都会释放。
- 持久队列：`room_inbox` 和 `room_timer` 合并为一张 `work_item`，带 attempts / max_attempts / available_at / lease_until / dedupe_key / last_error；到点、领取、完成、退避和死信同表。启动时 `reconcileRounds` 修房间/轮次指针，`reclaimWork` 回收租约。
- 存储按职责拆开：`store/work.js`、`store/rounds.js`、`store/timeline.js`、`store/assignments.js`、`store/projects.js`；`store.js` 只做打开、组合和房间视图。HTTP 动作移到 `actions/room-actions.js`，`service.js` 只做组合根。
- 轮次预算：`budgetMicroUsd` 进入 round；派发前按已知成本硬拦，超限暂停房间并写事件。完成摘要写进 round.completion，下一轮以一条系统消息带入步骤和决定。
- 状态契约：`roomStatusOf` 只返回 `idle/active/paused/stopped/archived`；`roundStatusOf` 管轮次；`idleDelivered` 表示当前是否已交付。工作室和聊天室不再用 `complete` 表示房间；侧栏、岛、项目页、交付记录统一读这套。
- 旧代码删除：`rooms/routine-runner.js`、`rooms/studio/subrooms.js`、`shared/routine.js`、run-needs 卡、routine 测试与样式、`state='complete'` 分支、closure 的签字状态、子房创建路径和父子字段。`followup`、`nextRoomId`、`pastGoals`、`phase`、`generation` 已无生产引用。
- 示例房改成 `idle + completed work_round`；首屏仍显示上一轮交付，但房间可以继续开下一轮。

验证：

- `npm test`：1098 项通过。
- `npm run test:ui`：18 条端到端通过（构建后的真实 UI）。
- `npm run check:docs`：7 个文档通过。
- `npm run check:acceptance`：88 个关联测试通过。
- `npm run check:regressions`：2 个回归通过。
- 自评：grep 检查 `server/crew`、`ui/src`、`shared` 中无生产 `state='complete'` 房间分支；无 routines/subrooms 引用；新增状态、事务、租约、恢复测试覆盖主要不变量。

未跑：

- 真实模型两轮 `npm run eval:rooms` / `eval:planning`。当前验证是单测、构建和 UI 端到端，不是模型真实交付。
- 真实 `.data` 还没有重置。schema v4 启动时会拒绝旧库；需要用户在确认后运行：

```bash
npm run data:reset -- --workspaces
```

脚本会先快照 `.data/backups`，再清 Lodge 数据和工作区，不动用户仓库。

## 2026-11-21 · 执行运行时拆分与单队列收口

- `rooms/studio/turns.js` 从 986 行收到 125 行，只做装配；`auto-check`、`planner-decision`、`turn-capture`、`resume` 移到 `rooms/studio/runtime/`，仍是模式内部模块，共享层没有反向依赖。
- 队列只留一条入口：`enqueueWork` 同时承担首次投递和按 id 重设到点时间；`setTimer` / `cancelTimer` 删除，审批超时改走同一 API。轮次结束在同一事务里作废 `round_id` 匹配的待办和租约。
- 死信不再沉默：`reclaimWork` 返回耗尽重试的项，调度器为每项写一条系统消息；未知 `kind` 直接失败进重试/死信，不再当作已完成吞掉。
- 事件恢复保留 `idempotency_key`，从 transcript 回放不会再绕过重复保护。
- 队列成为唯一的时钟：阶段超时除了内存计时器，还落一条 `stage.deadline` 持久项；进程重启后调度器仍会到点。调度器不再硬编码审批，到期项交给 `live.handleWork`，房型按 `kind` 处理；新增长期动作不需要改调度器。
- `npm test` 1102、`test:ui` 18、文档 7、验收 88、回归 2，`npm run check:done` 通过。

## 2026-11-21 · 去掉闭包机、显式轮次写入、聊天续跑、动作分族

- `closure` 状态机整台删除：工作室不再存 `open/planned/executing/verifying/rejected`；当前阶段和轮次状态是唯一事实。复核只检查房间是否还在跑，不再维护第二套生命周期。
- 存储写入分成两条显式路径：`updateRoom` 只写房间字段，写轮次字段直接报错；`updateRound` 才读写当前轮视图。工作室、聊天和房间动作各自走对的入口，终态轮仍拒绝写入。
- 聊天室补上持久时钟：讨论进行时占一条 `chat.round` 工作项，已发言次数落在 `chat.turns`；重启后从下一次发言续跑，不再整轮从头开始。调度器通过 `live.handleWork` 把到期项交给房型，聊天室和工作室共用同一条队列。
- `actions/room-actions.js` 从 518 行收到 37 行，只做分派；`lodge`、运行中动作、房间本体、轮次动作分到 `actions/room/` 四个文件。
- `npm test` 1099、`test:ui` 18、文档 7、验收 89、回归 2；`npm run check:done` 通过。

## 2026-11-21 · 真实评测：v4 空库、三题房间与规划

- 数据重置：停掉旧 8787 后运行 `npm run data:reset -- --workspaces`；重置前快照 `.data/backups/crew-1795268735990-pre-reset.db`，清掉 `.data`、`CrewWorkspaces`、`CrewWorktrees`，未动用户仓库。新库 `user_version=4`。
- 真实厂商：本机 `claude` CLI 走 `https://api.deepseek.com/anthropic`，模型 `deepseek-v4-pro`；评测引擎记录为 `claude` 和 `pi`。界面上的厂商名不等于实际厂商。
- 房间评测：`npm run eval:rooms -- --validate` 三把独立尺子 ok；`npm run eval:rooms` 3/3 PASS，0 返工，p50 57,849ms、max 69,990ms，合计 $0.5560（unknown 0）。逐题：revise-tone 24,657ms / $0.1252；slice-sheet 69,990ms / $0.2260；verify-catch 57,849ms / $0.2047。三题都 delivered、verdict pass、独立检查 ok。
- 规划评测：`npm run eval:planning` 3/3 PASS，100 分，p50 8,304ms、max 10,299ms，4 个决策问题，验收命令均为 `npm test`。
- 聊天评测：修掉 `eval:chat` 读已剥离 `seatBots` 的问题；本地脚本改为只读 `.data/crew.db` 取成员身体引用，不给公开状态加泄漏口。探针房 `room-dfa2cd85` PASS，执行者 20 字内回答且未使用工具；探针房已归档并删除。
- 这次真实跑使用新内核：轮次收口、单队列、阶段持久截止、聊天续跑和显式 `updateRound` 都在实际房间里走过，不是只跑单测。

## 2026-11-21 · 长期任务硬化：聊天补账、交接租约、重置归档

- 聊天发送前落 `chat.pending = {turn, memberId, beforeIds, sentAt}`；回复到达后和 `turns` 在同一个 patch 清掉。重启时用 `findReply` 找已有回复，找到就补账、不重发；找不到只记一次未回应，不重说，避免重复。@ 接力的下一位也落同样的标记。
- assignment 租约走同一条 `work_item`：`assignment.lease` 在 `sent` 后入队，每次捕获回合续租，`reported`/失败时取消。租约 8 分钟，短于阶段截止 15 分钟；一个成员到期只停这一位，还有别人在跑就继续等，最后一位停下才收口并合并已交回的部分。
- `stage.timeoutStage` 的收口抽成 `settleTimedOutStage`，阶段截止和成员租约共用；阶段截止保留为整步兜底。
- `data:reset -- --workspaces` 先归档 `CrewWorkspaces`/`CrewWorktrees` 到 `.data/backups/workspaces-<ts>/`，归档失败就中止；`data:restore --all` 或 `--workspaces <name>` 成对恢复，目标已存在默认拒绝，`--force` 才覆盖。
- 真实评测分层：新增 `eval:rooms:nightly` 和 `eval:planning:nightly`（各 3 次），不进入 `check:done`；文档写清提交、夜间、发版三档。
- 验证：`npm test` 1105 通过；工作区归档/恢复用临时根测试；未跑夜间真实评测。

```bash
npm run data:reset -- --workspaces   # 默认归档工作区
npm run data:restore -- --all        # 数据库 + 最新工作区
npm run eval:rooms:nightly
npm run eval:planning:nightly
```

## 2026-11-21 · 跨轮长期任务评测回路

- 新增 `evals/long-task/`：5 个场景（同室两轮、停止后开新轮、归档后恢复、预算触顶、人工退回），每个场景起两个独立进程，中间真实退出再重开，第二个进程先 `reconcileRounds` 再 `reclaimWork`。
- 结果：5/5 通过，8 轮、4 轮完成，返工 1、人工介入 1，成本 $0.0050（每交付 $0.0013），p50 145ms。结果写 `evals/long-task/results/latest.md`，不提交。
- 新增两条回归：停止后本轮工作在队列里全部取消、房间级审批不动；重启后第二轮仍在、旧轮消息隔离且只读。
- `check:done` 增加 `npm run eval:long-task`；它不调用模型，运行前不需要 Lodge 或基座。
- 工作室过时概念清理：删除无人引用的 `work-turn.js`；把「签字」统一成「确认」，同步设计文档、提示词、门禁错误和测试；架构/项目文档去掉 `nextRoomId`、`closure`、routines/subrooms 的历史比较，只留当前事实。
- 验证：`npm test` 1107 通过；`npm run check:done` 全绿。

## 2026-11-21 · 内核重启后真实复跑

- 环境：Lodge 8787 + 基座 8799；本机 `claude` CLI 走 `https://api.deepseek.com/anthropic`，模型 `deepseek-v4-pro`；评测引擎记录为 `claude` 和 `pi`。
- 房间评测：`npm run eval:rooms` 3/3 PASS，0 返工，p50 42,912ms、max 42,928ms，合计 $0.5331（unknown 0）。revise-tone 42,928ms / $0.2188；slice-sheet 42,842ms / $0.1643；verify-catch 42,912ms / $0.1500。三题都 delivered、verdict pass、独立检查 ok。
- 规划评测：`npm run eval:planning` 3/3 PASS，100 分，p50 7,280ms、max 9,327ms，3 个决策问题，验收命令均为 `npm test`。

## 2026-11-21 · 工作室接力回到共享房间

- 新增 `server/crew/rooms/studio/relay.js`：默认接力由代码决定，验收退回直接回执行官，通过回规划师；只有重做预算用完、合并冲突或没有执行成员时才回到规划师/人。
- 验收员退回不再叫醒规划师转达，而是由系统在共享房间发 `@执行官` 并新建重做交接；验收通过发 `@规划师` 收尾。
- 工作室文档补上“接力：谁把话交给谁”：一个共享房间、模型提供内容、代码决定下一棒；私有 worktree 只是执行目录，不做 @ 寻址。
- 接力投递不再依赖模型写 `@`：初次派发、并行派发、复核请求、退回重做都由系统投递并各发一条群聊投影；并行仍走成员执行上下文，但群聊只有一套。
- 提示词同步收紧：三个角色都不写 `@`；执行官只报结果，验收员只给判定，规划师只在例外时提交决定。
- 中间步骤验收通过后由系统直接收口并派发下一步；只有最后一步停在人的确认，由人收下这一轮交付。
- 单测覆盖 relay 规则、退回交执行官、通过交规划师；`npm test` 1117 通过，`npm run check:done` 全绿。

## 2026-11-21 · 工作室角色技能合并为 7 个

- 18 个单一技能按角色合成 7 个自写技能：规划师 `lodge-plan`、`lodge-design`；执行官 `lodge-build`、`lodge-diagnose`、`lodge-ui`；验收员 `lodge-review`、`lodge-ui`、`lodge-security`。
- 用新名字导入，避开基座“同名不同文”的冲突；合并掉的 16 个名字进 `RETIRED_SKILLS`，旧成员换身体或自定义时不再挂载。
- 每回合技能索引从约 320/406/379 tok 降到 99/152/151 tok；全部读完约 953/1,312/1,356 tok。
- 新增体积门禁：单个技能 ≤2400 字节、7 个合计 ≤16KB、每个角色最多 4 个技能。

## 2026-11-21 · 状态读侧收敛

- 删除未使用的 `roundDelivered` / `deliveredRoundOf`，当前交付只认 `idleDelivered`。
- 删除 kind 契约里的 `stateOf`（没有调用方），界面不再保留第二套阶段状态。
- 新增 `stageStatusOf` 和 `chatStatusOf`：阶段的阻塞、待回答、待拍板，聊天的正在看、正在总结，都收成一个词；岛、停止键、输入提示和 issue 投影统一读它们。

## 2026-11-22 · 状态目录、事件覆盖与只读重放

- `shared/states.js` 收拢房间、轮次、阶段、交接、聊天、work item、审批、复盘记忆和注意力状态与转移表；`kernel/round.js`、`assignments.js`、`chat/state.js` 改读这份清单。
- 交接每次状态变化补一条 `assignment.<status>` 事件；`round.started` 带阶段快照，供只读重放。
- 新增 `npm run replay:round -- --room <id> [--round <id>]`：从事件重建阶段和交接状态并与当前状态对比，只报告差异，不改写。
- 单测 1134 全过；`replay:round` 在本地 Lodge 房（没有轮次）正常返回“没有 round.started”的提示。
- 本地房间数据已按新规则清空并重建：数据库快照 `crew-1795280954665-pre-reset.db`，工作区归档 `workspaces-1795280954665`；重启后只剩新建的 Lodge 房，没有旧轮次。
- 服务端和共享层的房间、阶段、聊天、交接、审批、工作项、记忆状态字面量已全部换成 `shared/states.js` 常量；新增静态检查，裸状态字符串再次出现会让单测失败。
- 数据重置后只剩新建的 Lodge 房（`rooms [room-lodge]`），重启无报错。
- 项目不设独立生命周期：移除没有消费者的 `project.status`，项目页的“进行中/已交付”读最近一轮的轮次状态。
- 架构文档新增「状态与事件」：写明状态表是真相、事件只做审计与重放、事件覆盖范围、重放边界和未来的事件溯源路线。
- 交接补齐：验收通过建 `summary` 交接给规划师，退回后的例外决定建 `decision` 交接；交给人写 `handoff.human` 事件。
- 复核轮次在发起时固定验收员到 `stages[i].reviewers`；之后加验收员不会让已经通过的复核重新变成“缺一位”。
- 加成员只影响之后的交接：只可加执行官/验收员，规划师唯一；当前阶段 assignees 和在跑复核轮次不改；有未结束交接的成员不能移除。
- 状态图复查：岛补 `archived`，工作室和聊天室归档后都显示“已归档”，归档优先于运行态；额度暂停补了 `budget` 注意力，侧栏和暂停面板显示“这一轮的额度用完了”。
- 自动交付做成房间级选项 `autoDeliver`，默认关；最后一步验收通过后由系统以 `by: 'system'` 收口并完成这一轮，门禁不满足时退回人工确认。新建房间高级设置里可打开。

## 2026-11-22 · 房间 @ 跟随开关与聊天顺序

- 基座新增房间字段 `followMentions`（默认 true）：工作室和聊天室建房都写 false，成员私聊房间写 false。只对新房间生效，不做旧房迁移；旧数据按项目规则清掉。
- 聊天室不再靠成员 `@` 接力：轮次允许时先保证每位成员说一次，之后按 proposer → critic → synthesizer 互补，最后随机；续跑从本轮已发消息恢复计数，主持只负责收尾。隐藏的让位/举手信号和 `floor-signal` 模块已删除。
- 用户不带 `@` 的消息交给主持回答，主持不自行开轮；从成员选择器点名具体成员时直接交给被点名的人，结论后也一样，消息上标「直接问 X」。手打 `@名字` 不算结构化点名；`@所有人` 是开一轮受配额限制的讨论，正在讨论时明确说等这一轮结束；明确说“再走一轮/大家说说”也会开一轮。成员之间的 `@` 仍然不唤醒人。
- 基座三份 TypeScript 检查通过；`server/room-roots.e2e.test.ts` 16/16，覆盖建房、成员回复 @ 不再唤醒两种路径。
- 队列契约审计：生产入口只有审批超时、阶段截止、交接租约和聊天轮次；webhook/routines 尚未接线，用户消息和直接 `@` 不是 `work_item`。调度器从全局 `busy` 改成每房单活、房间间并发，慢聊天不再挡住别的房间的审批或截止；新增回归测试。
- 中期事件规则写进 architecture：聊天主持/直接/全员、工作室排队/叫停、晚到回合和 `work_item` 定时各有归属。
- 秘密脱敏收进 `shared/secrets.js`：提示词经 `sanitizeUntrusted`，证据在入库前，记忆写入前和日志统一走同一层；记忆过滤 `.env` 路径，验收员普通目录复制补了 `.env` 隔离测试。
- 静默规则收进 `shared/quiet.js`：只通知真正等人处理的 kind，同一房间 5 分钟冷却；进度和重试不弹。
- 聊天室主持默认写 2–4 句自然总结；正文进 `consensus`，明确的“下一步”行进 `todos`，结论仍可直接转成工作室交接。只有用户明确要分点/清单/待办/表格时才用五段结构。主持不再自行开轮，`@所有人` 开一轮，进行中明确要求等待。
- 轮次运行中的直接点名由房型策略拒绝，提示等结束或先叫停；聊天开轮前检查预算，额度用完时拒绝继续。
- 聊天室的 `open / round` 不再另存状态，由 `chatModeOf` 从 `chat.phase` 派生；发言在“每人先说到一次”之后按 proposer → critic → synthesizer 互补，最后随机。
- Lodge 单测 1159 全过；UI 端到端 18/18；`check:done` 全过；长任务评测 5/5。

## 2026-11-22 · 聊天否定语境与只读重放

- `askedForRound` 的否定规则只覆盖到分句末尾：逗号前后的“先不继续讨论了，但大家说说”仍然算请求；补了 6 条否定用例和 1 条混合句用例。（2026-11-22 已由 `roundVetoed` 取代，开轮由主持模型判断。）
- 新增 `npm run replay:chat -- --room <id> [--round <n>]`：只读读取 `room_event` 和 `messages`，按时间窗串起 `chat.round_started / speaker / summary_started / conclusion / continued`，列出每轮谁被叫到、谁实际发言、结论正文和下一步；自动摘要、成员没发言、有结论事件没结论消息都只报警告，不补造。
- 新增 `server/crew/rounds/replay-chat.test.js` 6 条用例，覆盖完整一轮、继续讨论、缺口、自动摘要和空事件。
- 本地 Lodge 房（没有聊天轮次）实跑 `replay:chat` 返回“没有找到聊天事件 / 没有找到聊天轮次”，没有报错，也没有改写状态。
- Lodge 单测 1166 全过；新的聊天重放命令已登记到 `package.json` 和运维/架构文档。

## 2026-11-22 · 聊天上下文分层与立场标签

- 聊天上下文分三层：上一轮结论由 `chatBriefOf` 从 `chat_conclusion` 的 handoff 变成共享简报；`speakerPrompt` 带上一位原话和这一轮的立场；成员自己只带一句 `voice`（说话习惯，最多 30 字）。
- 同日替换掉 `background`（阅历）：把人设写进 soul 背履历，既不是房间知识也不是个人声音；旧数据直接清掉，不做迁移。
- 修复界面建房丢失立场：此前 `normalizeMembers` 会丢掉 `stance`，从界面新建的聊天室实际没有立场分工；现在请求会保留立场，自定义成员按顺序补一个。
- 发言行在名字后显示两字立场（提议 / 质疑 / 收束），数据来自 `member.stance`；性格仍在后面用小字显示。
- 浏览器实测：聊天示例房三条发言分别显示“提议 / 质疑 / 收束”；新建房「更多选项」里三位成员的说话习惯输入可见且可编辑；375px 窄窗无横向溢出。
- 新增单测覆盖共享简报、发言提示、soul、建房请求、发言行和成员表单；e2e 补了说话习惯输入与立场标签断言。本地示例房验证后已删除，未留下测试房间。
- Lodge 单测 1180 全过；UI 端到端 18/18；`check:done` 全过（文档、验收、回归门禁和长任务 5/5）。

## 2026-11-22 · 内置浏览器可见与聊天室收敛审计

- 内置只读浏览器一直挂在成员 `body.spec.mcp` 上，但 `CapabilityReadOnly` 把它从工具连接列表里过滤掉，界面因此看起来“没有 MCP”。现在单独显示为不可编辑的“只读浏览器（系统）”，同时继续不出现在可编辑的 MCP 输入框里。
- 添加成员时在加入前就显示这项系统能力；没有浏览器授权时才显示“没有额外工具连接”。新增 3 条渲染测试。
- 示例房成员没有真实浏览器授权，浏览器里只验证到空状态；系统能力 chip 由 SSR 渲染测试覆盖。

- 用户消息认领从通用 `actions/room/round.js` 移回 `rooms/chat/service.js` 的 `handleMessage`；通用动作只按房型 id 分派。工作室“交给人后重做”移到 `rooms/studio/message.js`，通过 facade 暴露。
- 发言与总结提示从 `scheduler.js` 拆到 `rooms/chat/prompts.js`；调度器只保留编排、状态和等待逻辑。共享 `memberOf` 取代调度器里的本地重复实现。
- 初始聊天状态由 `room-types/chat.js` 的 `initialChatState` 一处生成，Lodge 复用，删掉两处重复字段。
- 界面不再直接读 `room.chat` 拼状态：房间视图、岛适配器和状态读模型统一用 `chatStartedOf` / `chatStatusOf`；删掉岛里未使用的局部变量。
- 旧的“系统随机唤醒成员”房内说明改成“按未发言和立场顺序”；`messagePolicy` 从房型窄契约移除。
- Lodge 单测 1192 全过；UI 端到端 18/18；`check:done` 全过（文档、验收、回归门禁和长任务 5/5）。

## 2026-11-22 · 工作室收敛与死代码清理

- “所有阶段已过”从 6 处复制收成共享 `stagesCompletedOf`：房间壳、成员面板、工作室时间线、空转守卫、加成员和记忆写入都读同一份。
- 侧栏不再直接读 `room.chat.phase`：聊天结论状态统一走 `chatStatusOf`。
- 删除没有调用方的导出：`ROUND_EVENTS`、`memberIdList`、`replayChatTransition`、`ROLE_IDS`、`BODY_CAPABILITY_LABELS`、`HANDOFF_FIELDS`、`GATE_DECISIONS`、`isLodgeRoom`、`mergeStateLabel`、`emptyUsage`、`work-round` 的 3 个未用上限常量；删除整份未使用的 `ui/src/room/presence.js`。
- 保留 `terminalRoundStatus`：它还有轮次生命周期测试在保护，不是垃圾。
- Lodge 单测 1193 全过；UI 端到端 18/18；`check:done` 全过（文档、验收、回归门禁和长任务 5/5）。

## 2026-11-22 · 全局收敛与旧称呼清理

- 用户称呼只认全局资料：删除启动时从旧房间 `humanName` 迁移的代码、`rememberHuman` 兼容入口，以及 `humanNameOf(room)` 的旧房间回退；`humanNameOf()` / `humanLabelOf()` 不再接收房间。
- 删除文件内无引用的 `MAX_PROJECT_BYTES`、未使用的 `dispatchOf` 和 `onMenuCommand` import；更新 `room-types` 里已经不存在“兼容门面”的注释。
- 房型投影从共享层收回各房型：`shared/room-issues.js` / `room-retro.js` 删除，改为 `rooms/chat/issues.js`、`rooms/studio/issues.js`，经 presentation 的 `issuesOf` / `retroOf` 钩子组装；共享层不再按 `roomType` 分支。
- 全局扫描确认没有无引用导出、无引用 import、无引用的顶层本地函数。
- Lodge 单测 1191 全过；UI 端到端 18/18；`check:done` 全过（文档、验收、回归门禁和长任务 5/5）。

## 2026-11-22 · 工作室策略按不可拆分整体拆分

- `studio/kind.js` 从 386 行降到 147 行，只负责装配策略；等待信号移到 `studio/needs.js`，约束和开场消息移到 `studio/record.js`，阶段/复盘投影已在 `studio/issues.js`。
- 拆分标尺：等待信号、创建记录、只读投影能独立测试、独立变化，不属于同一个不可拆分整体；房间实体、成员、阶段和 Assignment 协议没有动。
- 对外的 `studioKind` 形状、`rooms/kinds.js` 的三组窄接口、`service → 注册表 → kind` 依赖方向都不变；`studioConstraints` 仍经 facade 暴露。
- 单测仍为 1191 全过；UI 端到端 18/18；`check:done` 全过（文档、验收、回归门禁和长任务 5/5）。

## 2026-11-22 · 复核模块按职责拆分

- `studio/review.js` 只保留复核协调：请求、等待、判定入库、重试和交接。
- 复核文案移到 `studio/review-prompts.js`（判定格式、超时提醒、重试提示、外部证据围栏），复审判定规则移到 `studio/review-policy.js`（何时请影子评审、晚到判定是否仍有效、是否还有后续工作阶段）。
- 拆分标尺：提示文案随产品措辞变化，判定规则随复核策略变化，协调器随回合生命周期变化；三者能独立测试、独立变化，不是同一个不可拆分整体。
- 对外 `createReviewCoordinator` 和 `lateReviewStillValid` 的调用方式不变；`review-late.test.js` 改从 policy 模块导入。
- Lodge 单测 1191 全过；UI 端到端 18/18；`check:done` 全过。

## 2026-11-22 · 回合诊断从采集中拆出

- `runtime/turn-capture.js` 只决定这一回合的结果（证据、复核、决策、忽略、重复）；诊断字段、评估、落盘和阶段摘要移到 `runtime/diagnostics.js`。
- 拆分标尺：诊断 schema 和评估规则随观测需求变化，采集流程随回合类型变化；两者能独立测试、独立变化。
- `turn-capture` 的调用顺序和对外 `createTurnCapture` 不变；新增 3 条诊断测试，覆盖写入、无 writer、writer 抛错。
- Lodge 单测 1194 全过；UI 端到端 18/18；`check:done` 全过（文档、验收、回归门禁和长任务 5/5）。

## 2026-11-22 · 上 knip 死代码门禁

- 安装 `knip@6`，新增 `knip.jsonc`：列出 Electron、脚本、评测入口、fixtures 和 e2e；`ignoreExportsUsedInFile` 过滤“导出但只在本文件用”；`workspace-direct/plain` 的动态 provider 方法单独忽略；`pi` 和 `where.exe` 作为外部命令忽略。
- 新增 `npm run check:unused`，并接进 `npm run check:done`。
- 根据报告删除：`GATE_SERVER_NAME` 的重复 re-export、`min`、`onMenuCommand`、`view-format` 的 4 个未用投影函数；把重复的 `MAX_CHAT_TURNS_PER_ROUND|maxChatTurns` 收成一个 `maxChatTurns`。
- `npx knip --no-progress` 当前 0 发现；Lodge 单测 1194 全过；UI 端到端 18/18；`check:done` 全过。

## 2026-11-22 · dependency-cruiser 依赖图门禁

- 安装 `dependency-cruiser@18`，新增 `.dependency-cruiser.cjs`：禁止循环依赖、未解析导入、UI↔server 互引、shared 外引、内核直连具体房型、聊天室↔工作室互引、应用层直连存储/引擎/工作区适配器；测试文件不参与架构规则。
- 首轮抓到真实循环：`create/input.js → kinds.js → studio/kind.js → studio/start.js → create/input.js`。把 `alignmentPrompt` / `directPrompt` 移到 `rooms/create/prompts.js`，`start.js` 改依赖提示模块，`input.js` 保留 `normalizePlan` 和 `runnableCheck`；循环消失。
- `rooms/create/input.test.js` 和 `handoff-create.test.js` 的提示导入同步更新。
- 新增 `npm run check:deps`，接进 `npm run check:done`；当前 0 违规（639 模块 / 2067 依赖），单测 1194 全过，UI 端到端 18/18，`check:done` 全过。

## 2026-11-22 · 结论复制与排队动作

- 聊天结论卡增加「复制结论」和「转成工作室」，平时收起，悬停/键盘聚焦出现；触屏直接显示。复制的是结论原文，不复制房间状态。
- 排队消息保留「撤回」「插话」，改为同一套悬停图标动作；不增加逐条展开和逐条重试：成员的话是房间记录，重做是阶段级动作。
- 工作室交付卡的「回聊天室」也收进同一套悬停动作；后来「接着改」按钮被移除，统一由输入框承接下一轮。
- 浏览器实测悬停后两个图标出现；e2e 增加悬停 + 复制/转工作室断言，18/18 通过；验证用示例房已删除。

## 2026-11-22 · “动作按需出现”审计

- 已做到：聊天结论动作、排队消息撤回/插话、侧栏房间 `⋯`、成员 `⋯`、输入框发送钮、灵动岛展开、“回到最新”都只在需要时出现。
- 本轮补齐：结果卡逐文件「打开」和「回聊天室」改为悬停/聚焦出现；主结果文件、「在文件夹打开」「下载交付记录」保持常驻。后来移除「接着改」，改由输入框承接下一轮。
- 保留常驻且不视为违规：附件、添加成员 `+`、审批/提问卡动作、主结果文件打开；这些是当前上下文的主动作。
- 验证：`check:done` 全过；示例结果卡实跑时没有逐文件动作，逐文件悬停由样式与 e2e 构建覆盖。

## 2026-11-22 · 交接租约、开轮判断和聊天补账收口

- 交接租约改为“成员交回第一个新的证据回合就取消这条计时”，不再每次捕获都续租；取消点放在重复回合判断之后，避免重复/忽略回合误停新交接的计时。后面的长回合交给 15 分钟阶段截止兜底。新增假时钟回归：7 分钟时交回证据，租约还没到期就被取消（`live-turn-modules.test.js`）。
- 迟到回合归因：`assignmentForTurn` 接收 `startedAt`，按回合开始时在场的交接归因；拿不到开始时间才退回唯一一条未收口交接，避免把旧回合计到新交接上。新增用例覆盖旧回合、新回合和未知回合。
- 聊天开轮交回主持模型：模型说 round 就 round，不再由关键词表升级 reply；正则只保留明确拒绝的否决，`askedForRound` 由 `roundVetoed` 取代。否决覆盖“不要多说一轮/别再讨论了”，排除“不反对/不用等太久再走一轮/不过/特别”等误判；JSON 修复提示补上 round，第一次答非 JSON 仍能恢复开轮；否决后模型没给 reply 时补一句“好，那这次先不开了。”，不写空消息。
- 聊天重启补账新增结构化事件：找到回复写 `chat.turn_recovered`，没找到写 `chat.turn_missed`，都带 `turn/memberId/found`；不再只靠系统消息判断补账是否发生。
- 总结格式词补上“分条、逐条、列出、罗列、列表、大纲、提纲”和英文 bullet/list/table/checklist；`wantsStructuredSummary` 增加“分条说”和“简单说说”的正反用例。
- 文档同步：`docs/architecture.md` 的交接租约、聊天开轮描述和事件覆盖、`Lodge.md` 的主持行为与总结格式。
- 验证：`npm test` 1198 全过；UI 端到端 18/18；`npm run check:done` 全过；`knip` 0 发现，`dependency-cruiser` 641 模块 / 2078 依赖 0 违规。未跑真实模型评测；这轮是确定性逻辑和测试改动。

## 2026-11-22 · 交付卡被收尾交接卡住、交付页灵动岛被挤压

- 现象：执行官写完 `story.md`、验收员也通过了，但交付卡不出现，页面只显示「已交付」占位；房间里留着一句「还有交接没有收口，这一轮先不能结束」。
- 根因：验收通过后系统给规划师建了一条 `reason: 'summary'` 的收尾交接。它不是工作交接，`activeDispatchAssignments` 不会推进它，于是永远停在 `sent`；`completeRoom` 把所有未终态交接都当成阻塞，轮次无法完成，`delivery` 一直为 `null`。
- 修复：`completeRoom` 把收尾交接视为非阻塞，完成时把它标成 `passed`；结论消息按轮次幂等，重复收口不再写第二条；新增启动补交付 `reconcileCompletions`，旧版本里已经卡住、但所有阶段都过了的房间会在下次启动时自动收口。
- 交付页布局：删除重复的 `.studio-result` 行布局规则，恢复结果页的纵向布局；工作室灵动岛顶部留白从 6px 加到 18px，灵宠不再被裁掉。
- 验证：`npm test` 1200 全过；新增「收尾交接不阻塞交付」和「启动补交付」用例；UI 端到端 18/18；`npm run check:done` 全过；`knip` 0 发现，`dependency-cruiser` 641 模块 / 2081 依赖 0 违规。
- 真实房间验证：重启 Lodge 后，已经卡住的「这样的故事」由启动补交付自动收口；交付卡渲染 `story.md` 的 Markdown 正文《开锁》，灵动岛和灵宠完整显示，浏览器控制台无错误。

## 2026-11-22 · 回合归因诊断与交接行位置

- `turn-capture` 新增两条只读诊断：worker 回合没有可归属的交接时写 `turn.unattributed`；回合落到已终态交接时写 `turn.late_terminal`。两者都只进事件流，不改变实际归属。
- 交接系统消息不再居中：`message-view` 给 `meta.kind === 'handoff'` 的系统消息加 `data-chain=handoff`，样式改为贴着对话列左侧；阶段确认等普通系统提示仍居中。
- 验证：`npm test` 1204 全过；新增两条归因诊断用例和两条消息渲染用例；`npm run check:done` 全过；浏览器预览确认 `@验收员`、`@规划师` 两行回到对话列，交付卡和灵宠显示正常。

## 2026-11-22 · 首个长回合租约与交付结论顺序

- 交接租约在“第一个活动”到达时就取消，而不是等到第一个证据回合：一个成员只有一个在跑交接时，任何工具活动都说明它在做活，后续长回合交给阶段截止兜底。补了 `turns.trackTool` 的回归用例。
- `completeRoom` 把结论消息和结论文件移到“没有阻塞交接”之后；有真实交接没收回时只写一句“还有交接没有收口”，不再先写「已交付」。同一轮重复收口仍只写一条结论。
- 新增 `complete.test.js`：阻塞交接不写结论、不写结论文件；收尾交接只关闭一次，结论只写一次。
- 聊天室不再渲染「房间复盘」；工作室保留。新增 chat view 用例确认聊天 transcript 没有 `room-review`。
- Lodge 开房意图新增 `goal`：主持结合上下文写一句可开工的目标，建房优先用它；缺失时才回落到用户原话。例如“找人一起评”不再成为新房间目标。
- 从这里开出去的房写 `sourceRoomId` / `sourceName`；主持回合带最近三个未归档子房的状态和最后一轮结论。子房已出结论时，主持不会再让用户等或把内容贴回来；开房消息里的 `openRoomId` 和子房的 `sourceRoomId` 指向同一间房，按创建顺序去重。
- 聊天室收起时，岛的迷你胶囊显示状态词（正在聊 / 聊到这儿了 / 还没开始聊），不再只显示房间标题。
- 工作室只要这一轮还在跑就不再显示「空闲中」；没有当前回合时岛显示当前阶段。侧栏聊天室文案与岛统一为「还没开始聊 / 正在聊 / 正在收一下 / 聊到这儿了」，暂停/停止/归档的色调也一致。
- 新增 `e2e/island.spec.mjs`：示例聊天室和示例工作室在岛与侧栏上显示同一个结论/交付状态。修了 e2e 之间的样例房污染：新 spec 不再归档共享样例，mention spec 先选中工作室。
- 聊天室成员不再常驻侧栏，改成和工作室一样从房间 `⋯ → 成员` 打开；聊天室不再给「先别派活」，也不再出现「历史」。成员浮层打开调整窗口前会先收起，避免两个窗口重叠。
- 聊天结论的「复制结论 / 转成工作室」改成贴着结论卡右侧的紧凑图标行（2px 间距），不再在正文下方居中铺开；e2e 断言右边缘位置。
- 验证：`npm test` 1216 全过；`npm run check:done` 全过；UI 端到端 20/20；`knip` 0 发现，`dependency-cruiser` 646 模块 / 2095 依赖 0 违规。

## 2026-11-22 · 侧栏拆成列表、行和外壳

- `views/sidebar.js` 从 754 行收到 311 行，只留侧栏外壳：宽度、收起/展开、搜索焦点、键盘、拖拽和整体布局。
- 列表规则移到 `views/room-list.js`：排序、筛选、撞名时间戳、状态词、色调、可达名称和已交付判断；纯函数，输入房间列表，输出可渲染数据。
- 房间行移到 `views/room-row.js`：行本身、`⋯` 菜单、重命名、成员弹层、归档/删除确认；只通过 props 收 `room/stamp/onSelect/...`。
- 拆分标尺：外壳随窗口和侧栏布局变化，列表随“什么算需要你/已交付”变化，行随单间的菜单与确认流程变化；三者能独立测试、独立变化。
- 导出保持 `Sidebar` 不变；`sidebar.test.js` 和 `copy.test.js` 改从 `room-list.js` 导入纯函数。
- Lodge 单测 1194 全过；UI 端到端 18/18；`check:done` 全过。

## 2026-11-22 · 真实模型 dogfood：51 轮规划、4 轮工作室、1 间可见聊天室

- 环境：Lodge 8787 + 基座 8799；真实厂商是本机 `claude` CLI 走的 DeepSeek anthropic 端点（`deepseek-v4-pro`），聊天成员显示 `pi` / `deepseek/deepseek-flash`；界面上的 “Claude” 不是 Anthropic。
- 规划评测：`npm run eval:planning -- --runs 17 --out evals/planning/results/dogfood-planning-17`，3 个 case × 17 = 51 轮，50/51 PASS；p50 30,376ms，p95 48,702ms，max 69,942ms；格式合规 51/51，38 个决策问题。唯一失败是 `parallel-settings #4`（94 分）：它的 done 列表用 `npm test` / `settings.test.js` 表达测试，没有出现 case 要的字面“前端/后端/测试”，属于评测关键词过窄；同一 case 另跑 1 次 100 分。规划探针不写基座 digest，费用未能汇总。
- 这些规划轮是“开工卡提案”评测，不建房间，所以不会出现在房间页；真实房间账另记。
- 工作室真实房间：`npm run eval:rooms -- --runs 9` 跑到 `revise-tone` 4 轮后停止（评测房会出现在主界面）；4/4 PASS，全部 delivered、verdict pass、0 返工；p50 27,742ms，max 39,938ms；基座 digest 可见的 4 轮成本约 $0.3441。`slice-sheet` / `verify-catch` 本轮未重跑；`--validate` 显示三题独立尺子 ok，`verify-catch` 自带验收仍是弱检查（原样就绿）。
- 聊天真实探针：修复 `scripts/eval-chat.mjs` 选错房（原来会选中无成员的 Lodge 主房）后，`npm run eval:chat -- --room=room-06466ecc` PASS；执行成员真实回答，0 工具调用；新增 3 条选房回归。
- 可见聊天室：新建并保留 `room-4ff9a358`「真实联调 · 聊天」，自动起一轮 4 次发言；页面从「正在聊」走到「聊到这儿了」，侧栏与岛一致。`room_event` 是 4 条 `chat.speaker`（turn 1–4）+ `chat.summary_started` + `chat.conclusion` + 两条 `chat.transition`，与最终消息和结论卡一致；控制台和正文没有评测英文、文件路径或内部词。
- 现场 bug：可见聊天室里同一句“乙”的发言出现了两条。根因是流式文本先收口后，基座又补了一条同内容的 digest；两条都带不同 turnId，`dropStaleStreams` 只按时间戳去重，没拦住。修复：`finishStream` 对同一成员、同一句、5 秒内的 digest 重复不再收口；投影额外隐藏同成员同句的重复最终流式消息；旧重复记录也随投影消失。重启后真实房间只剩一条乙的消息，事件仍是 4 次发言。
- 子房 id 修正：开房消息里的 `openRoomId` 是当前真相，不是旧数据；删除重复的 `createdRoomId`，`linkedRoomBriefs` 只认 `sourceRoomId` 和 `openRoomId`，按房间创建顺序去重取最近三间。新增 4 条回归。
- 界面复检：聊天室 `⋯` 只有重命名/成员/归档/删除，没有历史；工作室仍有历史；聊天室成员面板没有“添加成员/先别派活”；选中成员先收起浮层再开调整窗口；结论动作行贴右（2px 间距，右边缘距卡片 8px）；活动中的工作室不再显示“空闲中”。
- 门禁：`npm test` 1225 全过；UI 端到端 20/20；`check:done` 全过；`knip` 0；`dependency-cruiser` 648 模块 / 2099 依赖 0 违规；docs/acceptance/regressions ok；long-task 5/5。
- 仍未跑：用真实模型强制暂停/恢复、归档/恢复这间可见房、子房联动；分别由 long-task 的 `budget` / `archive-restore` / `human-gate`、UI 端到端和 `linked.test.js` 覆盖。未跑就写未跑，不用“应该没问题”代替。

## 2026-11-22 · 长聊天 13 轮与第二轮页面复检

- 同一间可见房 `room-4ff9a358`「真实联调 · 聊天」继续跑，一共 13 轮、52 次成员发言、90 条消息；页面从「正在聊」走到「聊到这儿了」，`room_event` 是 13 次 `chat.round_started`、12 次 `chat.continued`、52 次 `chat.speaker`、13 次 `chat.summary_started` 和 13 次 `chat.conclusion`，与消息和结论卡对得上。
- 现场 bug 继续：上一轮只处理“同一时间、同一句”的重复；长聊里又出现 **内容相同但一条被截断、换行/空格不同** 的最终流式消息（例如“丙说的去程阴凉……”一条完整、一条少最后一句）。修复：投影按同成员、5 秒内、空白归一化后的前缀关系去重，保留更完整的一条；`finishStream` 对 digest 也按同样规则收口，避免再写入新的重复。
- 新增回归：同时间同句、短句让完整句、换行/空格不同、digest 截断、stale 流式消息；单测 1228 全过。
- 第二轮规划评测在并发跑长聊天时被基座拖慢，出现“90 秒内没有给出方案”和一次 17 分钟的聊天回合；停掉并发后顺序聊天恢复到 24–45 秒/轮。第二轮规划因此中止，不作为产品结果；第一轮 51 轮规划结果仍然有效（50/51，p50 30.4s）。
- 视觉复检：1280 宽浅色/深色、375 宽窄屏都无横向溢出；新房间对话框、聊天室菜单、成员面板、工作室交付页和结论动作行都看过。窄屏侧栏是单字头像 rail，保留完整 `aria-label` 和可展开按钮。
- 新房间流程：从页面点「新建房间」→ 填目标 →「先聊聊」切到聊天设置 →「开始讨论」，真实建出「给一间小书房挑一盏不刺眼的台灯」，页面正常显示甲/乙/丙、结论和「聊到这儿了」；保留作干净示例。长聊天房改名为「长聊天 · 13 轮」。
- 最终门禁：`npm test` 1228 全过；UI 端到端 20/20；`check:done` 全过；`knip` 0；`dependency-cruiser` 648 模块 / 2099 依赖 0 违规；long-task 5/5。

## 2026-11-22 · 20 条 UI 端到端 + 20 项页面状态检查

- `npm run test:ui` 20/20 通过；启动时基座连接警告不影响用例结果。
- 另用 Playwright 对真实 Lodge 页面做 20 项只读检查：首屏、房间列表、干净聊天房、话题、重复气泡、聊天室菜单、成员面板、成员调整窗口、结论动作行、聊天岛、内部英文/路径、工作室打开、历史菜单、交付岛、交付内容、新房间对话框、先聊聊/开始讨论、关闭对话框、窄屏无溢出。
- 结果 20/20；结论动作行实测 gap 2px、右边缘距卡片 8px；375 宽 `scrollWidth=375`、侧栏 rail 56px；正文无内部英文或文件路径。
- 检查过程中两次失败都是脚本问题：`调整成员` 的嵌套 dialog 选择器未加 `.first()`；动作行 opacity 有 120ms 过渡，focus 后立刻读取仍为 0。修正等待和选择器后全过；没有发现新的产品页面 bug。

## 2026-11-22 · 50 项页面检查与两处页面修正

- 在 20 条 UI 端到端之外，用 Playwright 对真实页面又做了 50 项只读检查：房间顺序与状态、长聊天 64 条发言无重复、菜单/成员/成员调整、输入框和附件、草稿跨刷新、@ 成员选择、工作室交付和输入条、终态成员、历史入口、新房间空目标禁用/更多选项/聊天设置、浅色/深色结果卡、375 宽无溢出、移动端菜单/成员面板不越界、无控制台错误、无失败请求。最终 50/50 通过。
- 页面取舍：曾给已交付结果加过「接着改」按钮；检查后判断多余——用户本来就该在输入框说下一轮，按钮只是把同一个动作说两遍。已移除按钮、`onContinue` 接线和相关测试，保留输入条和结果卡。
- 页面 bug 2：新建聊天室时成员区只显示「添加成员」，看不到实际会使用的甲/乙/丙。把默认成员收成 `shared/chat-defaults.js`，服务端 `room-types/chat.js` 和 UI 的 `chatUi.defaultMembers` 共用；新房间「更多选项」里现在能看到这三位。
- 视觉调整：聊天结论卡使用暖色结果底（浅色 `#FFF8EC`、深色 `#2B251B`）和专属边线，和灵动岛的暖金形成呼应；内容宽度、圆角、动作行保持不动。对比度和窄屏无溢出已复检。
- 全量前端矩阵：再跑 40 项，覆盖 1280/768/375、浅色/深色、Lodge/聊天/长聊天/工作室、菜单/成员/新房间/交付/键盘/axe；40/40 通过。长聊天 64 条发言，首屏约 677ms；聊天、长聊天、工作室、新房间四页 axe WCAG A/AA 都无违规。
- 可访问性 bug：工作室交付结果的可滚动预览区不能键盘聚焦，axe 报 `scrollable-region-focusable`。修复为 `tabIndex=0`、`role=region`、`aria-label="交付结果预览"` 和焦点环；新增断言，axe 复检通过。
- 结果位置调整：工作室做完后不再把交付卡置顶、也不再把工作记录折进「工作记录」。结果卡成为时间线最后一条，工作记录始终展开；打开已交付房直接落在最新结果，向上滚就是完整历史，输入框就在结果下面，检查完可以直接开下一轮。对应测试从「收起过程」改为「记录展开且结果在末尾」。
- 新任务 @ 修正：`startInitialStage` 的直接派发路径（新任务先对齐/直接派给执行）补了一条系统 `@规划师` / `@执行官` 交接投影；此前只有基座内部 prompt 带 @，房间时间线看不到。新增 start 回归，断言执行官收到第 1 步交接。
- 同时修了结果卡的 `crew-verdict-tag` 对比度：通过态从亮绿改为 `--bt-success-text`，axe 示例交付页恢复 0 违规。
- 第二轮规划单跑：46/51，p50 28,611ms，p95 45,600ms，max 47,645ms，格式 50/51；4 次 `parallel-settings` 的 `done-keywords` 被中文关键词误伤（输出用了 frontend/backend/npm test），1 次 `api-rate-limit` 把“限流维度”决策问题误判成已知事实。失败来自评测口径，不是并发资源竞争。
- 交付底栏调整：去掉「更多」「详情」两段文字披露，改成右侧 24px 图标行（交付说明 / 详情），悬停或键盘聚焦出现，间距 4px；展开仍在原滚动位置。真实页面浅色/深色各复检一次，图标右对齐、无溢出；端到端与 axe 重跑通过。
- 工作室 @ 复测（2026-11-22，真实模型，本机 claude 走 DeepSeek `deepseek-v4-pro`）：新建 `@交接测试`（room-a1a60ac4）跑完三步，时间线依次出现「@规划师 先对齐目标」「@执行官 第 2 步...交给你了」「@验收员 第 2 步...请复核」「全部验收员通过；@规划师 收尾」，UI 可见。此前看不到 @ 的原因是 Lodge 服务进程在加投影代码之前启动，Node 不热更服务端；重启后正常，不是旧代码残留。
- 时间线小字：系统自动签掉阶段的「第 N 步确认了 / 一起确认了」回执从主时间线撤掉，它和交接、结果重复；人覆盖（override）和自动交付（auto）两类 gate 提示保留。新增 `chain` 单测覆盖。
- 小字全量复查：自动检查通过、检查通过、可以验收、轮次开始、上一轮已交付这类成功回执不再写入；通用阶段 gate 回执也停写，只保留人覆盖和自动交付两类需要你知道的 gate。展示层的旧文案兼容过滤已删除，没有留下 shim。保留交接 `@`、失败/待处理、多人验收进度、影子评审和交付元数据；聊天室立场和性格小字保留。
- 房间数据清空（2026-11-22）：删除全部房间（含 Lodge），重启后重建一间空 Lodge；成员身体随房间退役，`CrewWorktrees` / `CrewWorkspaces` 里的工作副本和用户文件保留。
- 工作室交接样式（2026-11-22）：系统发起的 `@验收员` / `@规划师` 交接改为按发送成员的普通消息渲染，字号、缩进、说话行与成员发言一致；新消息带 `authorId` / `meta.from`，旧消息按收件人和文字回落。新轮的派发顺序改为“用户消息先落库，系统再派活”，不再出现 `@执行官` 抢在用户请求前面。影子评审嵌套 JSON 会被拆开，页面只显示摘要、理由、风险。
- 工作室 10 轮实测（2026-11-22，真实模型，本机 claude 走 DeepSeek `deepseek-v4-pro`）：前 7 轮交付；第 8 轮目标是“新建 README.md”，文件已存在被验收退回，执行官同 HEAD 重做后系统误判“没有新结果”，既不再送复核也不写人工证据，房间停在验收中。原因是人工阶段的去重逻辑没有把“退回后的重做”算成新结果；修复为只对最新一次退回之后的重复回合去重，并补回归。10 轮任务在定位后停止，不再把卡住的房间留在页面上。
- 工作室 2 轮复验（2026-11-22，真实模型，room-5989250f）：新房间 `工作室 2 轮验收`，2/2 交付，24,358ms / 21,814ms，4 / 3 条交接 `@`；页面检查系统小字 0 条，时间线所有项目左边统一 `x=294`，`@` 全部是成员气泡，无重复、无原始 JSON、无横向溢出；390px 深色同样通过；axe WCAG A/AA 0 违规；结果卡在时间线末尾。
- 同房续跑第 3、4 轮（2026-11-22，真实模型）：18,359ms / 21,423ms，3 条交接 `@`；页面系统小字 0、`x=294`、无溢出。发现并修掉三处复述/串轮：验收结论字号提到 14px，与实际理由为「无」时不再留下空的「理由」行；新轮开始时清空上一轮的影子意见、预览和复核重试标记，已交付页只取本轮最后工作步骤的意见；结果卡次要操作浮到右下角，不再用空底栏占 29px 高度。
- 全量样式复检（2026-11-22）：Lodge、聊天、工作室（4 轮）、历史、新房间，1100px 浅色和 390px 深色；全部无横向溢出，axe WCAG A/AA 0 违规；时间线 `x=294`（手机 `x=74`），名字行 13px、发言 14px、验收结论 14px、输入框 14px，聊天室立场/性格标签保留。
- 工作室单轮复验（2026-11-22，真实模型，room-b9414c78）：新房间 `工作室 单轮验收` 跑 `poem.md`，1/1 交付；4 条交接 `@`，系统小字 0，时间线 `x=294`，结果卡在末尾，无原始 JSON，无横向溢出，axe 0 违规。旧房间第 5 轮也已交付。
- 对齐结构（2026-11-22，真实模型，room-9ecef501）：规划师对齐回合改成固定结构「完成标准 / 口径 / 阶段 / 待确认」，口径用 `-` 列表，阶段按行；每步派活只写一句，不复述对齐内容。技能同步：`lodge-plan` 补上 Alignment reply 段，基座技能库旧版 sha 更新为新版内容，服务启动恢复 `role skill packs: 7 ready`。
- 重点加粗（2026-11-22，真实模型，room-60d4300c）：对齐标签改成 `**完成标准：**` 等加粗格式，中文标签不再用行内代码；页面上 strong 实测 14px / 600，和气泡正文同字号同字高，没有 code 标签。工作室和聊天成员的发言规则都加了重要信息加粗；模型没有主动加粗时，渲染层补文件名/路径、步骤和「完成标准/口径/下一步/风险/已交付」等标签，已加粗的不重复。基座技能库核验 7 个角色技能全部存在且 enabled。新房间 `工作室 加粗验收` 1/1 交付；系统小字 0、`@` 4 条全是成员气泡、`x=294`、无溢出。
- 14px 统一（2026-11-22）：正文、聊天、验收结论、用户气泡和输入框统一 14px / 22px；名字行 13px / 600，辅助信息 12px；加粗仍是 600 字重，字号不变。聊天室和工作室桌面/手机实测一致，无溢出。单测 1238、UI 20/20、`check:done` 全过。
- 工作室 10 间 × 2 轮（2026-11-22，真实模型，本机 claude 走 DeepSeek `deepseek-v4-pro`）：10 间新工作室各跑两轮，20/20 交付，0 失败；轮次耗时 min 12.8s / p50 16.1s / p95 27.8s / max 27.8s，平均 17.2s，费用至少 $1.17。每轮页面检查 20 次：系统小字 0、横向溢出 0、结果卡都在末尾、气泡/验收/输入框 14px、加粗最少 12 处、axe 0 违规。唯一 JSON 标记出现在第 02 间第 1 轮，复查该页已无 JSON；唯一「理由」标记是影子评审正文里的理由，不是空理由行。10 间房 `工作室 真实 01–10` 保留在侧栏，旧测试房已删除。
- 最终门禁：`npm test` 1229 全过；UI 端到端 20/20；`check:done` 全过；`knip` 0；`dependency-cruiser` 648 模块 / 2099 依赖 0 违规；long-task 5/5。

## 2026-11-22 · 四层审计修复与真实复验

- 数据边界：轮次字段收进 `shared/work-round.js` 的 `ROUND_FIELDS`（补上 `mergeResolved` / `advisorShadow` / `previews` / `reviewRetriedAt` / `stageDiagnostics`）；`updateRoom` 改轮次字段直接抛错，`updateRound` 才写 `work_round`。新增轮次字段重置断言。
- 消息归属：工作室消息写入时归当前轮，轮次结束后到达的消息归最后一轮；聊天室消息保持房间级。真实房 `room-5a11edad` 三轮共 69 条消息，数据库里 42 / 17 / 10 条分别落在三个 `work_round_id`，没有房间级工作消息。
- 开轮与收口原子性：轮次和用户消息在同一个 SQLite 事务里落库（`startWorkRound({ round, message })`）；结论消息和轮次完成也在同一个事务里落库（`finishWorkRound({ message })`），不再留下“有结论、轮次未结束”的半状态。两处都有回归测试。
- 旧轮次字段清理：真实库迁移前有 8 间房的 payload 还带 `advisorShadow` / `previews` / `stageDiagnostics` / `reviewRetriedAt` / `mergeResolved`；`SCHEMA_VERSION=6` 的 5 → 6 迁移在事务里清掉工作室房间的轮次字段，聊天室只清这五个，迁移后残留 0、11 间房仍可读、目标与阶段视图完整。
- 适配器边界：`rooms/base/thread.js` 移到 `server/crew/ports/threads.js`，房型只依赖 `createThreadPort`；dependency-cruiser 新增 `rooms-not-to-base-adapters`，现为 655 模块 / 2124 依赖 0 违规。
- 数据库迁移：`SCHEMA_VERSION=6`，4 → 5 在事务内补 `messages(room_id, seq)` 索引，5 → 6 清旧房间轮次字段，数据都保留；没有迁移路径的旧版本仍要求 `npm run data:reset`。真实库从 4 升到 6 后 11 间房全部可读；新增临时目录迁移测试，覆盖索引、工作室清理和聊天室保留目标。
- 界面三处：成员回复里的绝对家目录显示为 `~`（不改 `/tmp`、URL 等其它路径）；历史首轮标题改用目标，不再用房间名；侧栏每行只保留一个 Tab 停靠点，管理菜单用右键菜单键或 Shift+F10 打开。
- 现场 bug：侧栏对非当前房间点「历史」时只设置了历史目标、没有选中房间，页面不动。修复为同时选中；新增端到端「history opens for a room that is not the currently selected one」。
- 门禁：CI 增加 `check:unused`、`check:deps`、`check:acceptance`、`eval:long-task`；`check:acceptance` 从“文件存在”加严为“文件里有 `test(`，且会被 `npm test` 或 Playwright 的入口跑到”；新增 `npm run smoke:real`，只读检查 Lodge 8787、基座 8799 和本机模型路由。
- 真实评测：`npm run eval:rooms` 3/3 PASS，0 返工，p50 27,897ms；revise-tone 18,816ms、slice-sheet 30,895ms、verify-catch 27,897ms，全部 delivered + verdict pass + 独立尺子通过。真实厂商仍是本机 `claude` 走的 DeepSeek `deepseek-v4-pro`。
- 第二轮路径：在保留的 `工作室 真实 01`（room-5a11edad）开第三轮，10,949ms 交付；页面无 `/Users/`、输入框和发言 14px、加粗 14px/600、无横向溢出、控制台 0 错误；历史显示 3 轮，第一轮名仍是旧数据里的房间名，后两轮是目标截断。
- 收口事务真实复验（2026-11-22，真实模型，room-c7a64c99「工作室 真实 02」）：重启后开第 3 轮，11,796ms 交付；结论恰好 1 条且带本轮 `roundId`，轮次 completed，房间回到 idle。
- 最终门禁：`npm test` 1244 全过；UI 端到端 21/21；`check:done` 全过；`knip` 0；`dependency-cruiser` 655 模块 / 2124 依赖 0 违规；acceptance 115 条；long-task 5/5。
- 未跑：`eval:planning` 本轮未重跑；没有再做 10 间 × 2 轮的矩阵，只跑了 3 题评测和一间第三轮真实交付。

## 2026-11-22 · 发布信心四项

- 提交钩子：新增仓库内 `.githooks/pre-commit`，`prepare` 在 `npm install` 后执行 `scripts/setup-hooks.mjs` 把 `core.hooksPath` 指到 `.githooks`；本机已确认 `core.hooksPath=.githooks`，并用 `git hook run pre-commit` 实跑一次完整门禁，全绿。
- 真实基座夜间冒烟：`scripts/install-nightly-smoke.mjs` 写入 `~/Library/LaunchAgents/com.lodge.smoke.plist`，每天 09:17 跑 `scripts/smoke-real.mjs --notify`；失败走 macOS 通知，日志在 `~/Library/Logs/Lodge/smoke.log`。本机已安装并 `launchctl kickstart` 实跑一次，四项全绿：Lodge 11 间可读、基座 0.1.161、模型路由 DeepSeek `deepseek-v4-pro`。
- 视觉基线：`e2e/visual.spec.mjs` 录了三张 Mac 基线（桌面结果卡、390px 深色结果卡、新房间对话框），日期字段用遮罩；连续复跑 3/3 通过。Linux CI 没有同款字体与渲染，测试显式跳过，不拿噪声当门槛。
- 性能与并发预算：`e2e/budget.spec.mjs` 实测首屏 139ms、300 条消息 349ms、20 个并发 `/api/state` 30ms，阈值统一 5000ms；长列表同时断言无横向溢出。并发工作项仍由 `scheduler.test.js` 的「一房一活、房与房并发」覆盖。
- 验收门禁行为化：`check:acceptance` 现在实际执行矩阵链接的 113 条 Node 单测，2 条 Playwright spec 由 `test:ui` 执行；不再只检查文件存在。
- 最终门禁：`npm test` 1244、UI 端到端 27/27、`check:done` 全过、`knip` 0、`dependency-cruiser` 659 模块 / 2136 依赖 0 违规、验收 115 条、long-task 5/5。
- 仍未做：视觉基线只在 Mac 本地生效，Linux CI 跳过；夜间冒烟依赖本机 Lodge 与基座在运行，服务没起时会如实报失败，不会自动拉起服务。

## 2026-11-22 · 三行计划与三角色房间

- 规划师对齐回合改成三行：**做什么 / 怎么验收 / 做完是什么样**，不再写口径、阶段、待确认或内部步骤编号。
- 正常派活不再叫规划师重复一句话；计划就是派活，系统私下把完整任务送进执行官。
- 系统交接、阶段回执、完成记录只留在后台账本，不进房间时间线；房间里只有规划师、执行官、验收员和结果卡。系统只在审批、阻塞、超时、连接断开时露面。
- 真实房间「三行计划 01」：规划师只有 1 条三行计划，系统交接/阶段文本 0 条；执行官结果、验收 PASS、结果卡依次出现；无 `****`、无 `/Users/`、无横向溢出、控制台 0 错误。
- 门禁：单测 1258、UI 端到端 27、验收 113 条实跑、long-task 5/5、依赖 665 模块 0 违规。

## 2026-11-22 · 决策卡（真实模型）

- 契约与入口：新增 `shared/decision.js`（2–3 条路、每条写结果、推荐必须在选项内、`open/answered/cancelled`）；规划师通过 `lodge_gate_ask_decision` 提交，轮次字段 `pendingDecision` 只保留一张未决卡；回答走 `POST /api/rooms/:id/decision`，答案与所选效果私下送回规划师，规划师按这个方向继续。
- 真实房「决策卡验证 03」（room-f4d53fb3，本机 claude 走 DeepSeek `deepseek-v4-pro`）：规划师在目标对齐回合只发卡、不派活；卡上是「正式 / 轻松」两条路、各自写法、推荐「轻松」。用户在页面上选「轻松」后卡片消失，时间线出现「选：轻松」，规划师恢复并派给执行官，执行官改 `welcome.md`，验收 PASS，房间交付。
- 真实房「决策卡验证 04」（room-b57952ab）：规划师给 3 条路（写给开发者 / 写给普通用户 / 兼顾），推荐「写给开发者」；用户在页面上改选非推荐的「写给普通用户」，规划师明确按这个方向继续，执行官写出面向普通用户的 README 定位，验收 PASS，房间交付。证明选择不是摆设，也不是只认推荐项。
- 真实房「决策卡验证 05」（room-58af2f24）：规划师给「内部研发 / 外部用户 / 两段都写」三条路，推荐外部用户；用户选非推荐的「两段都写」，执行官按对外摘要 + 内部技术变更两段写完 `CHANGELOG.md`，验收 PASS，房间交付。
- 现场修掉两处接线 bug：`RoomView` 的 actions 没带 `answerDecision`，卡片因此不渲染；`server/route-table.js` 没登记 `decision`，点「按这个继续」返回 404。两处都补了回归：新增「UI 提交的每个房间动作都必须在路由表里」守卫测试。
- 覆盖边界：一次只开一张、旧卡/已关卡的重复提交由单测覆盖；「先不做」只关卡、不唤醒规划师，由单测覆盖，未再跑一间真实房取消。
- 等卡静默（真实房「决策卡验证 15」，room-ec822163）：基座群聊创建时只有规划师（1 人）；用户故意在等卡时发「@执行官 你在吗？」，执行官回复 0 条；用户选非推荐的「外部访客」后，规划师排完第一次派活时群成员恢复为 3，执行官写 `HANDOFF.md`、验收 PASS、房间交付。静默不是在提示词里求模型，而是基座的在场名单：不在群里就收不到 @。
- 先试过基座“挂起”，不成立：挂起会被一次 @ 直接唤醒（基座提示就是“@mention it or say resume”），还会投影成用户自己叫停；已删除，没有留兼容代码。改为 `chatMembersOf` 决定开局在场名单，`setMembers` 在第一次给非规划师派活前放回全员；重启时卡还开着就只留规划师。
- 收尾：验收 PASS 后规划师收尾的回合现在会自动确认最后一步，不再依赖用户再点一次“确认”；补了回归。此前 `/accept` 在最新证据没有对应判定时会拒绝，卡住的房 07 用人工覆盖收口。
- 门禁（2026-11-22，最终）：`npm run check:done` 全过；单测 1276、UI 端到端 27/27、构建、knip 0、依赖 670 模块 / 2181 依赖 0 违规、验收 115 条、long-task 5/5。

## 2026-11-22 · 三角色提示词（最新版）

- 三段提示词按用户给的版本写进 `shared/role-definitions.js`：规划师「对接 @执行官、@验收员 / 只拆解、分配和推进 / 任务很小就一步交付」；执行官「只做当前指派，不擅自扩大任务范围 / 卡住找 @规划师 / 完成状态 + 证据」；验收员「只核验、不主观推测 / 第一行只写 通过 或 不通过 / 证据不足即为不通过 / 合格则 @规划师，不合格 @执行官」。
- 系统只保留提示词没写的机械约束：规划师用 `lodge_gate_ask_decision` 和 `lodge_gate_rewind_stage`；执行官不自己 commit/push、命令验收必须带测试；验收员在复核副本里读文件、两轴分开、写 diff 之外的风险。
- 判定词统一：复核提示、重试提示和角色提示都改用「通过 / 不通过」；判定工具的 `PASS / REJECT` 保留为内部值，同时接受中文并映射；界面剥掉两种前缀，交接摘要和交付记录也显示中文。结果卡视觉基线因判定词变化更新了一张。
- 真实房「提示词验证 16」（room-663aea18，真实模型）：规划师发决策卡、用户选「写给内部同事」、规划师三行计划、执行官写 `ABOUT.md`、验收员聊天第一行是「通过」，房间交付。房间里没有出现 PASS/REJECT 文本。
- 观察：执行官这次仍把 `.crew/rooms/...` 内部目录写进了交付话术；验收员在结论里指出它不属于项目说明。提示词没有要求隐藏内部路径，后续可在展示层过滤。
- 门禁：`npm run check:done` 全过；单测 1279、UI 端到端 27/27、构建、knip 0、依赖 670 模块 / 2182 依赖 0 违规、验收 115 条、long-task 5/5。结果卡视觉基线因「通过 / 不通过」文案更新了一张。
- 缺事实提问（真实房「提问验证 17」，room-fd63e194）：规划师只调用 `lodge_gate_ask_question` 问「上次那条通知里的具体日期和时区是什么？」，房间进入 `openQuestion` 暂停；用户用输入框回答后暂停解除，规划师按日期/时区出三行计划，执行官写 `PLAN.md`，验收员第一行「通过」，房间交付。没有出现单选项决策卡。
- 规划师新版提示词同时落了两条边界：只有一个可行方向就直接做、不出卡；能用证据查到的不问用户。决策卡仍是 2–3 个选项 + 推荐，提问是一个问题，两条链路分开。
- 门禁：`npm run check:done` 全过；单测 1282、UI 端到端 27/27、构建、knip 0、依赖 670 模块 / 2182 依赖 0 违规、验收 115 条、long-task 5/5。
- 清库复验（2026-11-22）：`npm run data:reset -- --workspaces` 先归档数据库和工作区，再清空；新开真实房「清库复验 01」（room-189cec82），走决策卡 → 规划师自然计划 → 执行官改 `README.md` → 验收员「通过」→ 交付。规划师计划不再用「做什么 / 怎么验收 / 做完是什么样」的粗体标签，改成两三句自然中文；这一轮没有旧数据或旧模板残留。
- 门禁（自然计划改动后）：`npm run check:done` 全过；单测 1282、UI 端到端 27/27、构建、knip 0、依赖 688 模块 / 2212 依赖 0 违规、验收 115 条、long-task 5/5。
