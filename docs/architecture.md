# Lodge · 架构

> 本文回答：服务端怎么分层、数据真相在哪、交接和门禁怎么走、边界靠什么固定。
> 产品判断见 [Lodge.md](../Lodge.md)，界面规则见 [design.md](design.md)，运行与运维见 [operations.md](operations.md)。

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
service.js                   ← 路由分发，不写规则
应用层：rooms/*、kernel/live/*
领域层：room-types、gate、assignments、verifiers、orchestration、presentation
端口：crew-ports、runtime-port、workspace-ports、surface-port
适配器：store、engine、workspace、surfaces/base
```

依赖只向内：领域层不依赖应用层、端口或适配器；应用层只用注入的端口；适配器只在组合根装配；UI 不 import `server/crew`。

## 数据与真相

- SQLite `room` 存房间、版本、成员、阶段、closure、子房关系；`messages` 存时间线，证据和结论都是消息；`room_event` 存运行时 trace；`assignment` 存房间内交接。
- 房间目录 `transcript.jsonl` 先追加并 fsync，再写 SQLite；目标投影和证据文件可重建。
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
- `evals/planning/`：规划质量对照，不追求单次最好成绩。

## 已知边界

- 单用户、本地仓库、本地 CLI；不是云端或多人组织。
- 不是通用文件系统沙箱；没做的隔离不说做了。
- 截图由平台驱动 Chrome，是当前例外；之后可收成工具。
- 验收员声明能看图，不等于运行时真的看见；`seen` 才是事实。

## 许可

产品 MIT；OpenMausBot OSS 的 runtime、drivers、Electron 壳为 Apache-2.0；Pi 为 MIT。第三方 notices 随包。
