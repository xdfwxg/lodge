# Lodge · 架构

> 本文回答：服务端怎么分层、数据真相在哪、交接和门禁怎么走、边界靠什么固定。
> 产品判断与**原则总表**见 [Lodge.md](../Lodge.md#原则总表)，界面规则见 [design.md](design.md)，运行与运维见 [operations.md](operations.md)。

## 形态

- 服务端 Node 24，ESM，无框架；UI React 19，`createElement`，Vite；桌面 Electron 壳，macOS 发 ad-hoc 签名 zip。
- 基座是独立的 `crew-chat-base`，固定 OpenMausBot OSS 版本，HTTP 接入，默认 8799。基座不在本仓库改。
- 数据在 SQLite 单文件 + 房间目录的 transcript 与证据里。

## 分层

```text
Electron / Web
      │ HTTP + SSE
ui/src/store.js              ← 唯一的 UI 传输适配层
      │
views + room/<kind>/view.js  ← 房型视图策略
──────── HTTP / SSE 边界 ────────
server/index.js              ← 唯一组合根
service.js                   ← 路由分发与用例组合
应用层：rooms/*、kernel/live/*
领域层：room-types、gate、assignments、verifiers、orchestration、presentation
端口：crew-ports、runtime-port、workspace-ports、surface-port
适配器：store、engine、workspace、surfaces/base
```

依赖只向内：领域层不依赖应用层、端口或适配器；应用层只用注入的端口；适配器只在组合根装配；UI 不 import `server/crew`。

## 房型是策略

房间是唯一实体，运行模式是挂在房间上的策略，不是另一套房间模型。

| 单元 | 职责 | 变化原因 |
| --- | --- | --- |
| `Room` 记录 | 目标、成员、状态、阶段、Assignment、证据、交付；唯一实体 | 房间协议 |
| `room-types/*` | 名称、默认成员、能力矩阵、创建纯规则；不持有运行时 | 产品描述符 |
| `rooms/<mode>/kind.js` | 成员 soul、记录、启动、投影、等待信号；同一模式的行为不可拆 | 模式行为 |
| `rooms/kinds.js` | 唯一注册表；把策略裁成 `mode` / `presentation` / `lifecycle` 三组窄接口 | 组合与替换 |
| `service.js` | 路由与业务编排；模式差异优先走注册表钩子，具体模式用例在组合点装配 | 用例流程 |
| `ui/src/room/*` | 房间壳、房型视图、岛、共享展示；不 import `server/crew` | 呈现 |

**接口与依赖**

- 模式差异依赖 `roomModeForType`、`roomModeOfRoom`、`roomPresentationOfRoom`、`roomLifecycleOfRoom`；三组接口分别回答“怎么建/怎么跑”“只读投影什么”“哪些动作会改状态”。`followup`、`supportsRoutine` 这类差异走策略钩子；`service.js` 作为组合点装配具体模式用例。
- 模式差异的依赖方向是 `service → 注册表 → kind`、`kind → shared/ports`；反向 import、UI import 服务端、聊天室和工作室互 import 都由测试拦住。
- 新增模式 = 描述符 + kind + 视图 + 自己的动作入口；不改 `Room`、另一间房或共享房间协议。运行期不切换房型；底层角色仍是规划师/执行官/验收员三类。

**为什么这么分**

- **策略模式**：房型是运行策略，不是第二套房间模型；调度/圆桌/专项/接力共用同一份房间、成员和 Assignment 协议。
- **接口隔离**：创建运行、只读投影和生命周期分开，调用方只拿需要的那组，避免房型接口膨胀。
- **开闭与替换**：注册表和契约测试保证新模式可替换；关键生命周期已走钩子，剩余模式路由集中在用例入口，不再扩散到房间本体。
- **不可拆分标尺**：一个模式的创建规则、运行行为、投影和等待信号必须同时变，所以收在同一个 `kind.js`；房间身份、消息和交接必须一起保持一致，所以留在房间本体。

## 数据与真相

- SQLite `room` 存房间、版本、成员、阶段、closure、子房关系；`messages` 存时间线，证据和结论都是消息；`room_event` 存运行时 trace；`assignment` 存房间内交接。
- 房间目录 `transcript.jsonl` 先追加并 fsync，再写 SQLite；目标投影和证据文件可重建。
- 当前用户是全局资料（`profile` 表一份），房间展示和 agent 上下文从它读，不再各存 `humanName`；改昵称后下一次快照即全局生效。
- 交付后的改动另开下一版：房间记 `generation`、`sourceRoomId` 和 `continuation`（上一版目标、结论、文件、提交），旧版只读，版本链靠这三个字段连起来。
- 没有全局成员表，也没有全局 Assignment 表；成员和交接跟着房间走。证据与 verdict 正文留在消息里，Assignment 只存引用。
- 存储实现可替换，但业务真相必须落在支持约束与事务的持久存储。

## Assignment

发起人、接收人、阶段、原因、brief、状态、结果、证据引用、裁决引用、父交接、时间戳。

- 接收人是成员或子房，二选一；同 id 对应同一次交接，重复创建返回原记录，不覆盖证据。
- 状态链：`created → sent → reported → passed`，另分 `failed / rejected`；只通过一个 transition 入口改，校验和写入同一事务；终态不回退。送达失败是重试，新建一条指向失败那条，不重开旧记录。
- 派发状态和阶段任务从 Assignment 现算，不写回房间；交接卡按 id 找记录，按引用取证据。
- 返工指向被退回的那条；复核指向被复核的执行；子房交付是房间级 Assignment，父房重启补收口。
- 历史分页 `GET /api/rooms/:id/assignments`；每房保留最近 2000 条终态交接，未收口的不清理。

## 执行与验收

- 规划师派发给执行官；证据就绪后系统请求验收员复核。
- 验收命令在一次性副本里跑，记录命令、退出码、输出、diff 和改动文件。
- 多个执行官并行时各在自己的 worktree 里做，结束后集成；冲突停下交给人。
- 验收员只读 + exec，不能写；没有第二厂商时明确标「模型自查」。
- 人签字后阶段收口；最后一步与「验收与结论」合并，不让人为同一个判断点两次。

## 角色技能与房间投影

- `shared/role-toolbox.js` 是三角色常驻技能的唯一清单。技能文件在 `skills/role-packs/`，由 `server/skill-packs.js` 在组合根通过基座技能库导入并审核；不改基座源码。

| 房型 / 角色 | 技能 | 形态 |
|---|---|---|
| 规划师 | `lodge-grilling`、`lodge-task-breakdown`、`lodge-spec-driven`、`lodge-codebase-design`、`lodge-domain-modeling`、`lodge-api-design` | 6 个基座技能 |
| 执行官 | `lodge-tdd`、`lodge-diagnose`、`lodge-incremental`、`lodge-simplify`、`lodge-verify-before-done`、`lodge-frontend-ui`、`lodge-api-design`、`lodge-observability` | 8 个基座技能 |
| 验收员 | `lodge-code-review-2`、`lodge-verify-before-done`、`lodge-security`、`lodge-browser-evidence`、`lodge-accessibility`、`lodge-performance`、`lodge-observability` | 7 个基座技能 |
| 聊天室成员 | 不挂工程技能；只读文件、只读公网、`chat-voice`、`chat-stances` | 提示模块 |
| Lodge 主机器人 | `listen / auto-grill / route / close`（`LODGE_HOST_RULES`） | 内置提示，不占基座技能 |
| 房间层 | `room-issues`、`room-retro` | 只读投影，不是技能 |

- 共 18 个唯一基座技能、21 个角色挂载；`lodge-verify-before-done` 由执行官和验收员共用。`lodge-code-review-2` 先做 Spec 轴再做 Standards 轴，两份报告并列，不跨轴重排；旧的一轴 `lodge-code-review` 已停用。
- 聊天室没有 `grill-me`，也没有工程技能；主机器人自己判断何时追问，聊天成员只保留表达、席位和只读上下文。
- 成员技能仍走 `member.skills → body.spec.skills → engine.setBotSkills`。`body.js` 和 `body-swap.js` 合并角色技能：内置在前，自定义追加，最多 8 个；旧房间换身体时补上角色包。成员详情里的技能列表和 MCP 列表是只读展示：技能从角色包读，MCP 从成员授权读，不在成员卡里改。
- 技能的“调用”分三段：Lodge 只负责挂载（`engine.setBotSkills` → 基座 `PUT /api/bots/:id/skills-library`，名单存为 bot 的 `assignedSkills`）；基座每轮把技能索引写进系统提示（一行一条：名称、描述、`SKILL.md` 路径）；模型判断命中后用文件工具读全文。Lodge 不执行技能内容，`SKILL.md` 是方法说明，不是权限。
- 挂载有三道保证：启动时 `ensureRoleSkillPacks` 把包导入并审核，失败记 `ready=false`，不静默；建房前 `create.js` 检查 ready 和 `features.skillsLibrary`，不过就在造工作区前拒绝；`body.js` 挂技能失败会删掉刚建的 bot，建房失败。索引只对支持 workspace 文件的引擎注入（Claude Code、Codex 有；grok、openai-compat 没有），单成员最多 8 条，基座索引上限 30 条 / 4000 字节。
- 模型是否真读某个 `SKILL.md` 由模型判断，机制上不强制；能强制的是验收门禁和角色规则。核对看启动日志 `role skill packs: 18 ready`，或 `GET /api/bots/<id>/skills-library` 的名单。
- 规划师按情况走三档：想法还模糊用 `lodge-grilling`；讨论够了用 `lodge-spec-driven` 固定成阶段和验收；跨多个会话或要并行用 `lodge-task-breakdown` 拆出依赖。`grill-with-docs`、`to-spec`、`to-tickets` 不装原版，避免多出 GLOSSARY/ADR、spec 文件或外部 ticket 三个真相源。
- 聊天成员是 `participant`，不继承工程技能；只有只读文件、只读公网、`chat-voice` 和 `chat-stances`。外部动作仍由审批桥拦住。聊天室必须使用支持逐次确认的引擎；不会问人的模型在建房前就被拒绝，不能把只读写在提示词里假装实现。
- 验收员用 `lodge-code-review-2`：先做 Spec 轴，再做 Standards 轴，两份报告并列，只在各自轴内排序；不引入 subagent，也不把两轴合并成一个分数。
- `shared/room-issues.js` 和 `shared/room-retro.js` 是只读投影，不是技能：在每次组装房间视图（`presentRoom`）时直接算，模型看不到，也不花 token。工作室把阶段投成 issue，聊天把结论/待办投成 issue；复盘只引用真实返工、超时或用满轮次。它们不写房间状态，也不新增角色。

## 附件与视觉证据

- 附件不落房间存储：上传是 `POST /api/attachments` 的薄代理，文件进基座附件库；消息只带 `meta.attachments` 和 `<attached-image>` / `<attached-file>` 标记。
- 图片由 harness 转成原生输入；文本文件带正文，其它文件留路径；数量、大小和路径形状在消息动作里校验。
- HTML 交付在复核前由平台渲染成图：`screenshot.js` 调本机无头 Chrome，`visual-audit.js` 做像素检查，`previews.js` 记到房间。底座浏览器挡本地文件，这一层暂时由平台驱动 Chrome，是明确例外。
- 验收判定可带 `visual: { seen, colors, contrast }`；平台在交付卡上区分「没核对」「没看到」「看到」。成员 `body.capabilities` 记录声明的图片和工具能力，声明不是验证。
- 验收员选身体时先选声明能看图的实例，其中再优先不同厂商；没有能看图的才退回跨厂商复核。

## 边界靠测试固定

- `layer-boundaries.test.js`：应用层不 import 具体适配器；业务不解析基座地址；提示词不发送消息。
- `negative-list.test.js`：聊天室不读工作室状态；工作室不读 `room.chat`；共享内核只通过房型契约；提示词不按任务内容分支。
- `rooms/kinds.test.js`：两套房型实现同一组 mode / presentation / lifecycle 契约。
- `architecture.test.js`（UI）：共享 UI 不比较 `roomType`；房型视图只通过 kind 注册。
- `boundary.test.js`、`assignment.test.js`：领域边界与交接生命周期。
- `evals/planning/`：规划质量对照；`evals/rooms/`：房间交付固定题，外部脚本核对产出，不追求单次最好成绩。

## 已知边界

- 单用户、本地仓库、本地 CLI；不是云端或多人组织。
- 不是通用文件系统沙箱；没做的隔离不说做了。
- 截图由平台驱动 Chrome，是当前例外；之后可收成工具。
- 验收员声明能看图，不等于运行时真的看见；`seen` 才是事实。

## 许可

产品 MIT；OpenMausBot OSS 的 runtime、drivers、Electron 壳为 Apache-2.0；Pi 为 MIT。第三方 notices 随包。
