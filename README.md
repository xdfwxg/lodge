# Lodge

> 房间是本体，成员是房间里的人，Bot 是这个人现在的身体。

本地优先的房间式 AI 工作台。说清一件事，房间替你留下目标、过程、结果和证据；换引擎、换模型，房间还在。

- **聊天室**：把一件事聊清楚，留下结论；要动手时，带着交接简报开一间工作室。
- **工作室**：你只说目标。规划师拆步骤、按工作包组队；执行官交付，验收员独立复核，默认一位、最多三位。
- **说好的事**：给房间留一个定时承诺，到点提醒或开工，也可以发到邮箱。
- **本地优先**：跑在自己的仓库和已登录的 CLI 上，数据不搬家。

工作室成员只在自己的工作副本里写；外部动作先问你；人只处理不可逆和不可验证的事。

```text
聊天室 ──交接简报──▶ 工作室
                       ├─ 规划师：拆步骤、组队
                       ├─ 执行官：按工作包交付
                       ├─ 验收员：独立复核
                       └─ 证据与交付 ──▶ 人只处理不可逆和不可验证
```

## 文档

入口、通用思想、产品规则、协作契约和细则各归一处：

- [思想.md](思想.md)：通用判断——产品、分工、验收、工程和界面；原则总表是唯一索引，其他文档只写展开。
- [CLAUDE.md](CLAUDE.md)：给 agent 的协作契约——边界、常用命令和判断。
- [Lodge.md](Lodge.md)：Lodge 的产品规则和房间细节——两种房型、交接、验收、工作区和成员。
- [乔布斯.md](乔布斯.md)：取舍标准的来源、常见误读和引用边界；判断内核在 思想.md。
- [docs/architecture.md](docs/architecture.md)：服务端分层、数据真相、交接与门禁——数据怎么流、边界在哪。
- [docs/design.md](docs/design.md)：界面、交互和文案——字号颜色、组件、怎么写。
- [docs/agent-design.md](docs/agent-design.md)：Agent、工具、权限、上下文和失败的设计门禁。
- [docs/operations.md](docs/operations.md)：运行、基座、打包、运维与恢复——怎么启动、坏了怎么办。
- [docs/testing/acceptance-matrix.md](docs/testing/acceptance-matrix.md)：验收矩阵——每个能力由哪条测试或真实路径覆盖。

## 快速开始

### 桌面版（macOS）

从 GitHub Releases 下载 zip。首次打开被 Gatekeeper 拦下时，到「系统设置 → 隐私与安全性」点「仍要打开」。

桌面版内置基座和 Pi runtime；Claude、Codex 等其他 agent CLI 仍需本机安装并登录，模型凭据不进 app 包。

### 源码运行

需要 Node 24+、git、一个已登录的 agent CLI，以及本机运行的 OpenMausBot 基座（独立仓库 `crew-chat-base`，默认端口 8799）。

```bash
npm install
CREW_BASE_URL=http://127.0.0.1:8799 npm run dev
```

服务在 `http://127.0.0.1:8787`，UI 在 `http://127.0.0.1:5173`。

```bash
npm test               # 单测
npm run test:ui        # UI 端到端
npm run build          # 构建 UI
npm run desktop        # 构建后启动 Electron
npm run check:done     # 完成前验证：单测、UI 端到端、构建和门禁
npm run eval:rooms     # 真实房间评测（需要 Lodge 8787 和基座 8799）
```

测试使用独立临时工作区，不污染 `~/CrewWorktrees`。更多运行、打包、基座和 runtime 说明见 [docs/operations.md](docs/operations.md)。

## 许可与归属

产品代码 MIT；基座复用 OpenMausBot OSS 的 runtime、drivers 与 Electron 壳（Apache-2.0）；Pi 为 MIT。第三方 notices 随包。产品名、品牌和产品面全部属于 Lodge。
