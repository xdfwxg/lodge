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
- 未跑：`eval:rooms` 的真实模型两轮交付；旧轮只读详情页；routines/subrooms 后续以轮次重建。
