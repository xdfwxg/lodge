# Lodge

> 房间是本体，成员是房间里的人，Bot 是这个人现在的身体。

本地优先的房间式 AI 工作台。说清一件事，房间替你留下目标、过程、结果和证据；换成员、换引擎、换模型，房间还在。

- **聊天室**：把一件事聊清楚，留下结论，不转化成任务也算完成。
- **工作室**：把一件事做出来——规划、执行、独立复核、证据和可带走的交付。
- **本地优先**：跑在自己的仓库和已登录的 CLI 上，数据不搬家。

```text
聊天室 ──结论──▶ Gate ──开工──▶ 工作室
                                ├─ 规划师拆步骤
                                ├─ 执行官交付
                                ├─ 验收员复核
                                └─ 人签字
```

## 文档

根目录两份，`docs/` 三份，各有职责：

- [Lodge.md](Lodge.md)：产品判断与设计思想——该不该做、房间哲学、验收与边界。
- [docs/architecture.md](docs/architecture.md)：服务端分层、数据真相、交接与门禁——数据怎么流、边界在哪。
- [docs/design.md](docs/design.md)：界面、交互和文案——字号颜色、组件、怎么写。
- [docs/operations.md](docs/operations.md)：运行、基座、打包、运维与恢复——怎么启动、坏了怎么办。

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
npm test          # 服务端与 UI 行为测试
npm run build     # 构建 UI
npm run desktop   # 构建后启动 Electron
npm run test:e2e  # 单房间端到端
```

测试使用独立临时工作区，不污染 `~/CrewWorktrees`。更多运行、打包、基座和 runtime 说明见 [docs/operations.md](docs/operations.md)。

## 许可与归属

产品代码 MIT；基座复用 OpenMausBot OSS 的 runtime、drivers 与 Electron 壳（Apache-2.0）；Pi 为 MIT。第三方 notices 随包。产品名、品牌和产品面全部属于 Lodge。
