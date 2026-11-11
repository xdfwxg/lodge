# 复用地图

> 版本 v1.1 · 2026-11-11
> 目标：原型阶段能抄就抄，只写三家都没有的那一层。
> 原则：**抄代码，不抄产品。**

## 0. 三个来源与许可

| 仓库 | 本地路径 | 许可 | 能拿什么 |
|---|---|---|---|
| Claude-Bot（DS Bot 的 fork） | `_ref_deepseek-bot/` | Apache-2.0 | React UI、群/Goal 状态机、@ 解析、本地 CLI 适配 |
| OpenMausBot | `../OpenMausBot/` | Apache-2.0（`enterprise/` 除外） | Assignment 运行时、审批卡、SQLite/SSE 形态 |
| personal-agent | `../personal-agent/` | 自有 | 设计文档、纯 API runtime（不用） |

复制任何文件时一并保留 `LICENSE` / `NOTICE` 与原文件头。OpenMausBot 的 `enterprise/` 是商业授权目录，**一行都不进**。

## 1. 最终拼装

```
crew-chat/
  app/                 # 最小 Electron 壳（P3 后再加；P0 先跑 Vite + Node）
  ui/                  # React 19 + Vite
    src/{main,app,store}.js                  # 自己写：挂载、房间壳、SSE 状态
    src/{primitives,locale}.js               # 从 Claude-Bot app/ui 复制
    src/dsbot/{client,shared}/               # 从 ds-bot/src 复制，按需引用
    src/{app,crew}.css                       # 壳布局 + 房间自己的一层
  server/index.js      # P0：HTTP + SSE + SQLite 一处；P1 后再拆
    room/              # 房间即仓库、transcript、BRIEF（自己写）
    goal/              # Goal 状态机（从 DS Bot goals.js 移植）
    runtime/           # Assignment 运行时（从 OpenMausBot 移植）
    engine/            # CLI 适配（从 DS Bot local-agents 移植）
    store/             # SQLite（自己写，参考 OpenMausBot 的 WAL/FTS5 用法）
  shared/mentions.js   # 复制
  templates/           # 已有
  docs/
```

UI 用 JS（Claude-Bot 是 React-without-JSX），server 用 TS。Vite 同时吃两种，`tsconfig` 开 `allowJs`，不要为了统一语言先做一次大迁移。

## 2. 直接复制（改动 ≤ 10%）

| 资产 | 来源 | 去向 | 说明 |
|---|---|---|---|
| @ 解析 | `ds-bot/src/shared/mentions.js` | `shared/mentions.js` | host 与 client 共用同一份规则，先跑它自带的测试 |
| SSE 客户端 | `app/ui/src/api.js` | `ui/src/api.js` | 55 行，含重连；事件名按我们的协议改 |
| UI 基座 | `app/ui/src/{main,app}.js` | `ui/src/` | 它已经把 shell/sidebar/chat/goal 的 CSS 挂起来过，先让它跑 |
| DSH 原语替身 | `app/ui/src/primitives.js` | `ui/src/primitives.js` | 45 行，去掉对 `dsh-primitives` 的依赖 |
| 主题与头像 | `ds-bot/src/client/{themes,characters,mark,icons}.js` | `ui/src/` | 4 套主题 × 明暗；头像是程序化生成的 |
| 消息单元 | `ds-bot/src/client/{cells,user-message,fold,questions}.js` | `ui/src/` | 气泡、工具卡、折叠、提问卡；约 90 KB |

`app/ui/src/team.js`（271 行）也直接拿：它是 `state` / `chat` / `feed` 的现成 store 适配层，正好用来替换 DSH。先把 `api.js` 的端点改指向我们的 server。

## 3. 适配后复制（改接口，不改逻辑）

| 资产 | 来源 | 改动 | 风险 |
|---|---|---|---|
| 侧栏 | `ds-bot/src/client/sidebar.js`（1,155 行） | 去掉 DSH sources/sections；加「全部 / 机器人 / 群组」三个 tab | 三个 tab 原仓库**没有**，要自己写约 200 行 |
| 输入框 | `app/ui/src/chat.js` + `composer.js` | 原输入框在 DSH 壳里，换成自己的 textarea/send | 不要连 DSH 的语音、听写 |
| Goal 状态机 | `ds-bot/src/host/goals.js`（812 行）+ `goal.js`（403 行） | 换 store 与 session 调用；状态与证据门禁原样保留 | 它的 `pass` 只校验证据非空，**不执行命令**；执行器由我们补 |
| 群轮次 | `ds-bot/src/host/groups.js`（97 KB）+ `turns.js`（69 KB） | 只移植 round / @ / 批次唤醒逻辑，替换 DSH Session | 整文件抄会带进 60 行日志上限与 DSH 依赖 |
| CLI 适配 | `ds-bot/src/host/local-agents/{adapter,claude,codex,acp,jsonrpc,engines}.js` | `adapter.js` 现在实现 DSH 的 `LlmAdapter`，改接 `TurnRunner` | Claude 用 `--input-format stream-json --output-format stream-json --verbose` + `--resume`；Codex 走 `codex app-server` JSON-RPC；其余走 ACP |
| 群设置 | `ds-bot/src/client/group-settings.js` | 只留公告（2,000 字上限）与成员/权限；拆掉 DSH 页面 | 公告注入点在 `groups.js`，一起搬 |
| 文件夹规则 | `ds-bot/src/host/folders.js` | 保留优先级与重叠校验 | M3 的 worktree 边界可以借它的校验思路 |
| Assignment 运行时 | `OpenMausBot/server/runtime/{runtime,store,tree,invariants,types,level}.ts` | 约 2,960 行；只改宿主接口 `TurnRunner`（`types.ts:296`） | **不要**搬 `runtime-coordinator.ts`；`capabilities.ts` 重写；它 import 了 `shared/approval-mode.ts`、`shared/redact.ts`、`peer-provenance.ts`、`provenance-label.ts`，对应的四个文件一起搬 |
| 审批卡 | `OpenMausBot/src/components/{ApprovalCard,QuestionCard,AskCard}.tsx` | 状态机与交互照搬，样式按 Claude-Bot 的 CSS 重写 | 它是 Tailwind 4；**不要**为了三张卡引入 Tailwind，避免两套样式系统 |
| 消息渲染 | `OpenMausBot/src/components/{ChatMarkdown,RichMessageRow,MessageActions}.tsx` | 只作为 Markdown/操作条的参考 | Claude-Bot 的 `cells.js` 已够用，不要双份 |

移植 OpenMausBot 运行时前，先写一个 100 行的 `TurnRunner` 假实现，把它的不变量测试跑绿，再接真实 CLI。**生命周期与 10 条不变量一行不改。**

## 4. 自己写（三家都没有）

1. **房间即仓库**：`transcript.jsonl` 追加写、`BRIEF.md` / `decisions.md` 归人、`evidence/` 落命令与退出码。
2. **HTTP + SSE 服务**：`POST /api/*` + `GET /api/events`，`Last-Event-ID` 续传，事件 `event_id` 幂等。
3. **Room Scheduler + Context Builder**：游标增量、交接包、一回合只选一个发言人。
4. **验收执行器**：一次性集成副本、超时、环境变量白名单、产物哈希；明确「协作隔离，不是安全边界」。
5. **独立性分级**：`vendor | model | none`，降级必须在验收卡上标注。
6. **「全部 / 机器人 / 群组」tabs 与输入框**：Claude-Bot 原仓库没有。
7. **最小 Electron 壳**：借 `app/src/main.mjs` 的窗口/打包结构，删掉 DSH 启动与 browser/computer 面板。
8. **SQLite schema 与迁移**：只借 OpenMausBot 的 WAL/FTS5 用法，不借它的表。

## 5. 明确不搬

| 东西 | 原因 |
|---|---|
| DSH 宿主与插件注册（`ds-bot/index.js`、`app/src/*`） | 多一层宿主就会多一份状态真相 |
| `state.json` 作为唯一存储 | 我们要 SQLite 事务 + transcript 先写 |
| 群日志 60 行上限（`groups.js:32`） | 与「房间持有完整历史」冲突 |
| `browser/` `computer/` `connectors/` `im/` `office/` `mobile/` | 与首版无关，且拖大攻击面 |
| OpenMausBot `enterprise/` | 商业授权，不可复用 |
| OpenMausBot `runtime-coordinator.ts` | 与它的宿主强耦合 |
| OpenMausBot `Sidebar.tsx` / `ChatView.tsx` / `GroupView.tsx` | 绑在 3,349 行 store 与 bot-as-person 概念上，拆不干净 |

## 6. 原型拼装顺序

| 步 | 拿什么 | 判据 |
|---|---|---|
| P0 | `SHELL_CSS`/`CONVERSATION_CSS` + `mark.js` + `primitives.js` + 自己的侧栏、时间线、输入框与 server 骨架 | 打开是 Claude-Bot 的样子，侧栏有房间和三个席位（已达成） |
| P1 | Goal 状态机 + CLI 适配 + 验收执行器 | 计划 → 改文件 → 命令 → 证据 → PASS/REJECT → 人接受 |
| P2 | transcript 追加 + SQLite + 重放 | 关掉重开一致，能从 transcript 重建 |
| P3 | 真实 Claude Code CLI | 一次完整交付；取消/断线/未登录有可读提示 |

## 7. 复用时的五个坑（前三条预判，后两条实测）

1. **DS Bot 的 UI 不是独立应用**。`ds-bot/src/client/` 是 DSH 的插件 UI，输入框、设置页、部分卡片在 DSH 壳里。`app/ui` 是已经做过一次抽离的休眠分支，从它开始，不要从 `ds-bot/index.js` 开始。
2. **JS 无 JSX**。组件用 `createElement` 写，复制后能跑，但不要顺手改成 TSX——那会把 1,000+ 行组件全变成 diff。
3. **OpenMausBot 运行时不能整目录拖**。它 import 了宿主侧的 4 个文件与 `zod`，直接 `cp -r` 会 typecheck 失败；按依赖逐个搬，先跑不变量测试。
4. **`app/ui` 只服务机器人，不服务群**。`useChat` 在 `botId === undefined` 时直接返回，`team.js` 也只渲染 Bot。群聊当初由 DSH 壳渲染，所以房间时间线、侧栏分组、输入框这一层**必须自己写**；能从它拿的只有 `primitives.js`、`api.js` 的 SSE 形状和 `team.js` 的挂载方式。
5. **不要 import `sidebar.js`**。它 import `cells.js`，后者再 import `widget-cell.js`，引出未安装的 `deep-view/*` 与整个 DSH 依赖图。界面只需要它的 CSS 时，把 `SHELL_CSS`/`CONVERSATION_CSS` 之外的侧栏行样式抄进 `ui/src/crew.css`（本仓库已这样做）。同理，`dsh-primitives.js` 与裸包名 `@deepseek-ai/dsh-client-ui-primitives` 都在 `vite.config.js` 里指到自己的 `ui/src/primitives.js`。

## 8. 外部设计参考（2026-11-11）

不整包引入，只取设计或小模块；许可证已核对。

| 项目 | 许可 | 可取之处 | 结论 |
|---|---|---|---|
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT | Thread / Message / Composer primitives、tool-call 卡片、流式 runtime adapter | **备选基座**：以后若脱离 Claude-Bot 皮肤，优先换它；当前已有皮肤，不重复引入 |
| [LibreChat](https://github.com/danny-avila/LibreChat) | MIT | 消息 `parentMessageId` + 分支元数据，fork-from-message | 抄数据模型与 fork 处理，不抄 UI |
| [Mission Control](https://github.com/builderz-labs/mission-control) | MIT | 用 `Last-Event-ID` 游标先重放、再转直播 | **已采用**：`server/index.js` 的 `/api/events` 就是这套 |
| [Flowise](https://github.com/FlowiseAI/Flowise) | Apache-2.0（`enterprise/` 除外） | 单次 run 的执行轨迹抽屉：节点状态、输入输出、耗时 | 做 run 检查器时借形态 |
| [Countersign](https://github.com/starkyru/countersign) | MIT | 审批请求 JSON Schema、`pending → approve/reject/edit → 审计` 状态机 | 设计审批卡时参考；项目太新，不引依赖 |
| [LobeChat](https://github.com/lobehub/lobehub) | LobeHub Community License | 席位状态行、切换器 | **不用代码**：衍生分发需商业授权 |
| [Open WebUI](https://github.com/open-webui/open-webui) | 自定义（限制移除品牌） | — | **不用** |
| [Vercel AI Chatbot](https://github.com/vercel/chatbot) / [AutoGen Studio](https://github.com/microsoft/autogen) / CrewAI Studio | Apache-2.0 / MIT | 整包应用 | **不用**：剥壳成本高于重写所需部分 |

一句话：**运行时与状态机继续用 OpenMausBot + Claude-Bot；UI 皮肤用 Claude-Bot；只把 LibreChat 的分支模型和 Countersign 的审批状态机当设计参考。**
