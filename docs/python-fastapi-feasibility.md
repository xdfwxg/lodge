# Lodge 后端迁移至 Python + FastAPI · 可行性报告

> 版本 v1 · 2026-11-12 02:39（GMT+7）
> 评估对象：`/Users/wangxuguang/workspace/crew-chat`，快照时有 4 项未提交改动，**项目处于活跃开发中**，行号与行数会漂移
> 评估口径：只评估「把产品层后端整体替换为 Python + FastAPI」，不评估局部引入 Python 脚本
> 依据：代码只读清点 + `设计思想.md` / `docs/lodge-design.md` v0.11 / `docs/reuse-map.md` §8.5

---

## 0. 决策摘要

| 维度 | 判定 | 依据 |
|---|---|---|
| 技术可行性 | **中高** | 产品层与基座已是 HTTP 跨进程解耦，Engine 是语义端口 |
| 数据/制品兼容 | **高** | SQLite 单文件跨语言、payload 为纯 JSON 文本、房间产物是 git 仓库 + 文本文件 |
| 前端改动量 | **零** | 同源 `/api/*` + SSE，前端无硬编码端口与语言标识 |
| 运行时语义风险 | **高** | 同步阻塞 I/O 密集、单线程 event loop 假设、双向 SSE 与取消链 |
| 工程资产重写量 | **高** | 22 个测试文件 / 1867 行测试 / 正则门禁 / 评测 harness / 文档守卫 |
| 新引入的运行时代价 | **负收益** | 基座 `crew-chat-base` 仍是 Node，迁移后变成 **Python + Node 双运行时** |
| 与设计文档一致性 | **冲突** | §10.0「技术选型已定」、§12「产品层是 JavaScript ESM」 |
| 预计工作量 | **8–14 人周**（单人，不含需求继续变化） | 依据见 §5 |

**结论：技术上可行，工程上不建议现在做。**

这个项目的架构恰好让「换语言」变得可能，但没有让「换语言」变得值得。产品层与基座之间已经是 HTTP（8799），所以换语言不会破坏基座；但基座本身仍是 Node，FastAPI 并没有消灭 Node，只是**多加了一个运行时**。更关键的是：当前真正的问题（一处红测、文档状态超前记功、门禁不校验退出码、事件写入顺序与契约不符）与语言无关，迁移会把这些问题 1:1 搬过去，并额外附赠一整套跨语言并发语义的回归风险。

---

## 1. 现状盘点

| 项目 | 数值 | 说明 |
|---|---|---|
| 后端总行数 | 7,348 | `server/*.js` + `server/crew/*.js` |
| 其中测试 | 1,867（22 个文件） | `node:test` + `node:assert/strict` |
| 非测试业务代码 | 4,784 | 纯逻辑 678 + 实时链路 3,687 + 组合根/适配约 400 |
| 前端 | 2,134 | React 19.3 + Vite 8.3，`createElement`，**不随迁移改动** |
| 脚本/评测 | 160 | `scripts/check-docs.mjs` + `evals/planning/run.mjs` |
| 运行时 | Node.js v22.22.2 | `package.json` 要求 `>=22.5`，文档推荐 24 |
| 依赖 | 6 个 npm 包 | react / react-dom / react-markdown / remark-gfm / vite / concurrently |
| 数据库 | `node:sqlite` `DatabaseSync`，WAL | `.data/crew.db`，3 张表，payload 全为 JSON TEXT |
| 上游基座 | `crew-chat-base`，HTTP 8799 | OpenMausBot OSS 血统，Node，§2.1 要求一行不改 |

**最重要的一条**：迁移后的形态是 `Python/FastAPI 产品层 → HTTP → Node 基座 → CLI`，而不是 `Python 全栈`。语言数量从 1 变 2，部署单元从 2 变 2（数量不变，异构度上升）。

---

## 2. 可行性分层判定

### 2.1 架构层 · 可行

`设计思想.md` §2.1/§2.2 规定：`index.js` 只做组合根与 HTTP/SSE，`engine.js` + `base.js` 是唯一适配层，crew 不 import 基座。`base.js` 全部是 `fetch` 打 8799，`engine.js` 只做语义归一化（group/thread/bot → Room/sessionRef）。**Engine 端口本身就是跨语言边界**，Python 侧只需实现同样 15 个方法，不触碰基座。这是本次评估里唯一站得住的理由。

### 2.2 数据与制品层 · 可行

- SQLite 是跨语言的单文件格式；`PRAGMA journal_mode=WAL` 是库文件内的持久设置，Python `sqlite3` 可直接打开同一个 `crew.db`。
- `room(id, payload, version)` / `messages` / `room_event` 全是 TEXT 列 + `JSON.stringify` 纯文本，无 SQLite JSON 函数、无触发器、无外键关联；`randomUUID()` 是标准 UUID，`ts` 是毫秒整数 —— **没有 Node 特有的序列化格式**。
- 房间产物 `.crew/rooms/<id>/`（BRIEF/GOAL/CONCLUSION/transcript/events/evidence）与 `git worktree` 全部是文本 + 标准 git，语言无关，历史房间记录可原样带走。

### 2.3 前端契约层 · 可行（零改动）

`ui/src/store.js` 只认同源 `/api/*` 路径、`EventSource` 的 4 个事件名（`msg` / `msg.patch` / `room` / `dispatch`）、`data:` 为 JSON、`id:`/`since` 游标、`{ error }` 错误体。源码中**没有** `8787`/`8799`/`localhost` 字面量，也不引用任何后端框架标识。`vite.config.js:10` 的 proxy 目标改不改都行（FastAPI 监听 8787 即可）。只要 FastAPI 复刻 18 条路由 + SSE 帧格式 + 状态码映射，前端一行不用改。

### 2.4 运行时语义层 · 高风险

现有代码大量依赖 **Node 单线程 + 同步阻塞** 的隐含前提：

- `store.js` 的 `DatabaseSync` 全部同步；`updateRoom` 用 `BEGIN IMMEDIATE` + `WHERE version = ?` 乐观锁；`emit('msg')` 在写库后的**同步调用栈**里遍历 SSE clients 并 `res.write`。
- `worktrees.js` / `room-repo.js` / `paths.js` 用 `execFileSync` 跑 git，**且没有 timeout**；`room-repo.js` 的 `gitAvailable` 与 `paths.js` 的 `projectRoot` 在**模块加载时**同步求值。
- `transcript.jsonl` 先 `openSync/writeSync/fsyncSync` 再写 SQLite；`events.jsonl` 恰好相反（`COMMIT` 后镜像，失败只 warn 不回滚）。
- `lock.js` 用 `openSync(file,'wx')` + `process.kill(pid,0)` 做数据目录锁。

Python 侧要么把这些整体放进 `asyncio.to_thread` / 线程池，要么改成全同步 + ASGI 线程池（`def` 路由）。**两种选择都会改变并发时序**：SQLite 连接不能跨线程共享、`BEGIN IMMEDIATE` 与 `busy_timeout` 行为不同、SSE 广播从「同步栈内写」变成「跨线程推队列」，`emit` 与事务提交的先后顺序可能被重排。证据链最怕的就是这种静默时序变化。

### 2.5 工程资产层 · 高成本

- 22 个 `*.test.js`（1,867 行）全部要重写为 pytest；其中 `store.test.js` 直接用 `DatabaseSync` 造旧表验证增量迁移，`acceptance.test.js` / `worktrees.test.js` / `room-repo.test.js` 直接调 `execFileSync` 造临时 git 仓库。
- `boundary.test.js` 是**扫 `server/crew/` 目录下 `.js` 源码的正则门禁**（13 条规则，拦 `node:http` / `../engine.js` / `botId` / `threadId` 等）；Python 下要么改成 AST/lint 规则，要么换一套等价机制，等于重新设计分层强制手段。
- `evals/planning/run.mjs` **直接 `import { createEngine }`** 调真实基座做语义评测；`scripts/check-docs.mjs` 检查三份文档里的固定字符串与 `boundary.test.js` / `store.test.js` 是否存在。两者都要移植，且 `check:docs` 的断言内容要跟着改。
- `concurrently` 双进程启动、`vite build` 产物由 Node server 同源托管、`.claude/launch.json` 调试配置 —— 全部替换为 uvicorn + `StaticFiles(html=True)` + 新的进程编排。

---

## 3. 模块迁移难度矩阵

| 模块组 | 行数 | Node 依赖 | Python 对应 | 难度 | 主要风险 |
|---|---|---|---|---|---|
| 纯逻辑规则（gates/attention/budget/permission/seats/digest/presentation/result/progress/watermarks/planning-eval/workspace-paths/demo） | 678 | 无（仅 `process.env`） | 直接翻译为 dataclass / pydantic 模型 | 低 | 规则语义逐条对齐，用现有单测做双跑对照 |
| HTTP 组合根 `index.js` | 229 | `node:http` / `node:fs` / `node:path` | FastAPI 路由 + `StreamingResponse` + `StaticFiles` | 中 | 18 条路由、正则路由、请求体 64 KiB / 16 MiB 上限、`bytes` 双形态响应、SPA fallback |
| 适配层 `base.js` + `engine.js` | 471 | `fetch` / `AbortSignal` / `TextDecoder` / `AbortController` | `httpx` 流式 + `asyncio.Task` 取消 | **高** | 上游 SSE `\n\n` 分帧、UTF-8 跨 chunk 边界、2 s 重连、取消与错误区分 |
| 存储 `store.js` + `room-repo.js` + `lock.js` | ~500 | `node:sqlite` / `fsyncSync` / `openSync('wx')` | `sqlite3` + `os.open(O_EXCL)` + `os.fsync` | **高** | 事务边界、乐观锁、WAL/连接级 PRAGMA、双写顺序 |
| 实时链路 `live.js` / `live-turns.js` / `room-create.js` | ~1,400 | 相对 import 为主，间接调子进程 | asyncio 任务链 + 串行队列 | **高** | 回合协调状态在闭包里（`reviewFor` / `turns` / `acceptanceChain`），重启不恢复；轮询等待 1 s / 90 s、4 次重试 |
| worktree / 验收 / 沙箱 | ~700 | `execFileSync` / `spawn` / `detached` / `process.kill(-pid)` | `subprocess.run` / `create_subprocess_exec` + `start_new_session` + `os.killpg` | **高** | 120 s 超时杀进程组、`PORT` 注入、`sandbox-exec` / `unshare -n` 平台分支、`node_modules` 软链 |
| 服务编排 `service.js` / `roster-recommend.js` / `dispatch-service.js` / `handoff.js` | ~1,000 | 混合 | pydantic + 依赖注入 | 中 | 开工卡轮询、失败显式回退、三态结果 |
| 测试 / 门禁 / 评测 / 文档守卫 | 1,867 + 160 | `node:test` / `node:assert` | pytest + ruff + 新门禁 | 中高 | 契约等价性，不是「能跑」而是「行为一致」 |

---

## 4. 关键技术难点

1. **双向 SSE**：出站是 `clients: Set<res>` + 25 s `: ping` 心跳 + `since` 历史重放 + `Last-Event-ID`；入站是 `watchEvents` 用 `ReadableStream.getReader()` 读基座 `/api/events`，`\n\n` 分帧、`data:` 行拼接、2 s 重连。FastAPI 侧需要 `asyncio.Queue` 广播 + `StreamingResponse` 生成器，并自行处理断连清理与背压 —— 这是整个迁移里最容易出隐蔽 bug 的部分。
2. **取消语义**：`AbortController` / `AbortSignal.timeout` / `signal.aborted` 在 Python 没有对应物，需用 `asyncio.Task.cancel()` + `CancelledError` 区分主动取消与网络错误；且现有 `wait(2000)` 重连等待不可被 signal 打断（最多残留 2 s）。Stop 链路（`POST /stop` → `live.cancel` → `interruptBot`）与 SSE 订阅取消（`detach` 中的 `unsubscribe`）是**两条独立链路**，容易被合并错。
3. **SQLite 事务**：Python `sqlite3` 默认 `isolation_level` 会隐式 `BEGIN`，与显式 `BEGIN IMMEDIATE` 冲突；需设 `isolation_level=None` 并逐条复刻 `COMMIT`/`ROLLBACK`/乐观锁 `WHERE version = ?`。`foreign_keys`、`journal_mode` 是连接级 PRAGMA，多连接/线程池下每个连接都要重新设置。
4. **子进程与证据链**：验收命令在一次性 detached worktree 副本里跑，`evidence` 记录 `command/exit/output/diff/files/isolated`；`spawn` 用 `detached: true` + `process.kill(-child.pid,'SIGKILL')` 杀整个进程组。Python 对应 `start_new_session=True` + `os.killpg`，但 `fsync` 顺序、候选 commit 与 diff 采集时机必须与现在逐字对齐，否则证据链可信度下降。
5. **文件锁与进程存活**：`lock.js` 的 `wx` 独占创建 + `kill(pid,0)` 在 Python 可用 `O_EXCL` + `os.kill(pid, 0)` 复刻，但信号处理（SIGINT/SIGTERM 释放锁）要换成 `atexit` + signal handler。
6. **结果三态与错误映射**：`result.js` 的 `ok/created/accepted/fail` + `BusinessError` → 组合根映射 400/404/409/405/500，系统异常必须**直接抛 500** 不能伪装业务拒绝。FastAPI 需用自定义异常处理器 + `JSONResponse`，别让 pydantic 的 422 破坏既定契约。
7. **平台分支**：`sandbox.js` 的 macOS `sandbox-exec` / Linux `unshare -n` / Windows 未接 fail-closed，以及 16 个 `CREW_*` 环境变量（含 `CREW_WORKTREE_PORT_BASE=4100`、`CREW_DISK_MIN_FREE_MB=512`、`CREW_ROOM_BUDGET_USD=5`）需逐一映射，漏一个就是静默行为差异。

---

## 5. 工作量估算

| 阶段 | 内容 | 估算（单人·人周） |
|---|---|---|
| 0 | 契约冻结：18 条路由 + 4 类 SSE 事件 + 状态码 + 环境变量清单；建立双跑对照用例 | 0.5–1 |
| 1 | 组合根 + 存储 + 适配层（HTTP/SSE、SQLite、锁、Engine 端口） | 2–3 |
| 2 | 纯逻辑 12 模块 + 服务编排逐模块翻译 | 1.5–2 |
| 3 | 实时链路：live / live-turns / worktrees / 验收 / 沙箱 / 开工卡 | 3–5 |
| 4 | 22 个测试 + 边界门禁 + 评测 harness + 文档守卫 + 部署/调试配置 | 2–3 |
| 5 | 真实基座 8799 联调 + E2E 全链路复验（建房→证据→签字→commit）+ 文档改写 | 1–2 |
| **合计** | | **8–14 人周**（约 2–3.5 个月） |

估算依据：后端 7,348 行、非测试业务 4,784 行、22 个测试文件、16 个环境变量、双向长连接与进程组取消等高风险点。**未计入**：需求继续变化带来的返工、并发写入导致的目标漂移、真实 CLI 的随机性回归。项目当前仍在活跃开发（快照期间新增了 `handoff.js`/`handoff.test.js` 等），这意味着迁移是**打移动靶**，实际工期更可能靠近上界。

---

## 6. 风险登记

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| 并发语义差异导致静默丢更新 / 证据顺序变化 | 高 | **致命**（动摇「可验可溯」核心价值） | 双跑对照 + 逐条复刻事务/fsync 顺序 + E2E 证据链断言 |
| 双运行时长期并存，排障链路变长 | 高 | 中 | 契约测试固化 8799 边界；明确基座不随迁 |
| 活跃开发中迁移，目标持续漂移 | 高 | 高 | 先冻结版本与契约，再开工；否则不做 |
| 22 个测试重写后「能跑但语义不等价」 | 中高 | 高 | 保留 Node 版为 golden，用同一批用例交叉验证 |
| 与 §2.4「换 runtime 时业务与存储不动」冲突 | 确定 | 中（架构原则被架空） | 若迁移，必须同步修订设计文档的技术选型章节 |
| 许可合规：本地 `LICENSE` 是 MIT、无 `NOTICE`，文档要求保留上游 Apache-2.0 归属 | 中 | 中 | 迁移前先独立补齐合规，与语言选择无关 |
| 收益不确定：无性能/生态刚需 | 高 | 中 | 先写清楚「为什么必须 Python」，写不出来就不做 |

---

## 7. 与《设计思想》的符合性判定

| 条款 | 原文要点 | 对本次迁移的判定 |
|---|---|---|
| §2.1 | 基座 runtime/drivers 一行不改；驱动差异只在 `base.js` / `engine.js` | **不冲突**（基座确实不动） |
| §2.2 / §2.4 | 「换 runtime 只实现 Engine 端口；**业务与存储不动**」 | **冲突**：换语言必然重写业务与存储，替换路线的成本前提被推翻 |
| §9 | 依赖方向 `index.js → engine/base + crew`，UI 只通过 HTTP/SSE | 可保持（分层可复刻） |
| §10.0 / §36 | 「技术选型已定」：OpenMausBot 基座 + Node ≥22.5 + `node:sqlite` WAL + React 19/Vite 8 | **直接冲突**，属于产品决策变更，不是技术升级 |
| §12 | 「产品层是 JavaScript ESM + React 19 + Vite 8」；「设计目标不等于现状，落不到必须写设计中」 | **直接冲突**，须同步改写，否则文档失真 |
| §10 评审清单 | 「能否删除、配置化、或用框架原语替代？」「可否不写？」 | 按此清单，全量重写的答案倾向「不写」 |

**核心洞察**：文档允许的是「换 runtime」（实现 Engine 端口，业务与存储不动），不是「换语言」（业务与存储全部重写）。架构解耦确实让语言可换，但那是**副产品**，不是设计承诺；把副产品当成迁移依据，会误判代价。

---

## 8. 方案对比

| 方案 | 改动面 | 风险 | 收益 | 与文档一致 | 建议 |
|---|---|---|---|---|---|
| A 维持 Node.js | 无 | 低 | 聚焦修红测、门禁、文档口径 | 一致 | **推荐** |
| B 渐进类型（JSDoc + `tsc --checkJs`） | 3 个文件 + 1 条脚本 | 极低 | 拿到端口/三态/席位的静态检查，零构建改动 | 一致 | **推荐（若要类型安全）** |
| C 只把 HTTP 组合根换 FastAPI，crew 保持 Node | 新增桥接进程 | 高 | 名义上「用了 FastAPI」，实际制造第二个进程与双写 | 冲突 | 不推荐 |
| D 全量迁移 Python + FastAPI | 后端 7,348 行 + 全部测试/文档 | 高 | 见 §9 | 冲突 | 现阶段不推荐 |
| E 绞杀者：新能力用 Python 独立服务，老服务不动 | 局部 | 中 | 可验证 Python 生态价值，不推倒现有资产 | 需补文档 | 若坚持引入 Python，**这是唯一低风险路径** |

---

## 9. 收益的客观评估

公平地讲，Python + FastAPI 确实有真实好处，不能一笔抹掉：

- **pydantic 运行时校验**：正好补上当前 `room.payload` 是 JSON blob、读出来全靠约定的缺口，也顺手解决上一轮讨论的「跨进程边界静态类型失效」。
- **`sqlite3` 稳定成熟**：不必再依赖 Node 22 的实验特性 `node:sqlite`（测试时会打 ExperimentalWarning）。
- **FastAPI 的 DI / OpenAPI / 后台任务**：18 条手写路由与三态映射可收敛为声明式契约；SSE 与静态文件有现成原语。
- **AI/Agent 生态**：若未来要接 Python 侧的模型、评测、数据分析库，同语言更顺。

但这些收益在本项目里被明显稀释：① 基座仍是 Node，Python 生态优势够不到引擎层；② 运行时校验可以用 pydantic，也可以在现有 JS 里加一个轻量 guard，不必换语言；③ 当前瓶颈是证据链与状态口径，不是路由写法；④ 项目明确「M3 之前不演示」，尚无性能或并发压力需要换栈。**收益是「更好写」，代价是「重写 + 重新证明可信」**。

---

## 10. 决策建议与重评触发条件

**建议：不迁移。** 优先级排序：

1. 修 `sandbox.test.js` 的红测，把文档里的测试数字改成实测值；
2. 统一 `events.jsonl` 写入顺序与 §8.5 状态口径，清掉 `source_hash`/`revise` 的超前记功；
3. 给 `gates.js` 补 `exit === 0` 与命令/diff 校验；
4. 若要类型安全，走方案 B（JSDoc + `checkJs`）；
5. 补齐许可合规（NOTICE / 归属文件头）。

**出现以下信号再重新评估**：① 团队主力转为 Python 且 Node 侧无人维护；② 需要深度复用 Python 专属的 Agent/评测/数据生态，且该能力必须进业务层；③ 基座 `crew-chat-base` 本身被替换为非 Node 实现；④ 项目结束活跃开发、契约冻结，且有一整个迭代周期可专用；⑤ 出现 Node 无法解决的性能/部署硬约束。当前五条**均不成立**。

---

## 11. 若仍决定迁移：分阶段路线与验收门禁

1. **冻结**：打 tag，冻结 18 条路由、4 类 SSE 事件、状态码、16 个环境变量、`.crew/` 产物格式；把现有 22 个测试跑出的结果存为 golden。
2. **先写契约测试，再写代码**：同一批用例同时打 Node 版与 Python 版，字段级比对（尤其 `seq`、`version`、`evidence.meta`、`needsYou`）。
3. **按 §3 难度矩阵自低向高**：纯逻辑 → 存储 → 组合根 → 适配层 → 实时链路。每阶段必须双跑通过才进下一阶段。
4. **E2E 复验不可跳过**：真实基座 8799 + 真实 CLI，跑通单人房与三人组（建房 → 开工卡 → 验收命令副本 → PASS → 人签字 → CONCLUSION → 本地 commit），逐项核对 evidence 的 `exit/output/diff/isolated`、worktree 清理、GC、成本闸门、Stop。
5. **文档同步**：改写 §10.0 技术选型、§12 对外表述、`reuse-map.md` §8.5 状态、README；`check-docs.mjs` 断言同步更新；补 `NOTICE`。
6. **回滚线**：任何阶段出现证据链不一致，回到 Node 版，不带着差异上线。

---

## 附录 A · 关键事实索引

| 事实 | 位置 |
|---|---|
| 18 条路由 + SSE + 静态文件 | `server/index.js:144-219`；`serveStatic` `:125-142`；心跳 `:221-223` |
| 结果三态 → HTTP 映射 | `server/crew/result.js:1-20`；`server/index.js:84-93` |
| 上游 SSE 客户端（分帧/重连/取消） | `server/base.js:72-114`；`server/engine.js:319-337` |
| SQLite 建表/PRAGMA/事务/乐观锁 | `server/crew/store.js:10-24,78-105` |
| transcript / events 双写顺序 | `server/crew/store.js:123-136,66-75,99`；`room-repo.js:24-29,37-42` |
| 数据目录锁 | `server/crew/lock.js:1-52` |
| 子进程超时杀进程组 | `server/crew/acceptance.js:23-64` |
| 边界正则门禁 | `server/crew/boundary.test.js:8-24` |
| 评测直接 import Engine | `evals/planning/run.mjs:8,29-34` |
| 前端契约 | `ui/src/store.js:70-119,181-235`；`vite.config.js:8-12` |
| 启动编排 | `package.json:9-18`；`server/index.js:225-229` |

## 附录 B · 端口与环境变量

- 端口：`8787` Lodge HTTP（`CREW_PORT`）、`8799` 基座（`CREW_BASE_URL`）、`5173` Vite、`4100+` 席位端口（`CREW_WORKTREE_PORT_BASE`）。
- 16 个 `CREW_*`：`CREW_DATA_DIR`、`CREW_PORT`、`CREW_BASE_URL`、`CREW_MODEL`、`CREW_MODEL_INSTANCE`、`CREW_WORKSPACE_ROOT`、`CREW_REPO`、`CREW_SEED_DEMO`、`CREW_ACCEPTANCE_NETWORK`、`CREW_WORKTREE_ROOT`、`CREW_DISK_MIN_FREE_MB`、`CREW_WORKTREE_PORT_BASE`、`CREW_WORKTREE_TTL_DAYS`、`CREW_WORKTREE_GC_ORPHANS`、`CREW_GLOBAL_BUDGET_USD`、`CREW_ROOM_BUDGET_USD`；另有注入子进程的 `PORT`。
- 前端**不硬编码**任何主机或端口，全部同源 `/api/*`。

---

*本报告为只读评估，未修改任何现有代码、文档或配置；新增文件仅此一份。*
