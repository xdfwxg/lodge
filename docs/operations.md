# Lodge · 运行与运维

> 面向开发和发布，不是产品介绍。产品与思想见 [../Lodge.md](../Lodge.md)，结构见 [../架构升级.md](../架构升级.md)。

## 开发运行

```bash
npm install
npm run dev        # 服务 8787 + UI 5173
npm test           # 独立临时工作区里跑服务端与 UI 测试
npm run build      # 构建 ui/dist
npm run desktop    # 构建 UI 后启动 Electron
```

开发模式需要本机已经运行基座。默认连接 `http://127.0.0.1:8799`，也可以用：

```bash
CREW_BASE_URL=http://127.0.0.1:8799 npm run dev
```

基座是独立的 `crew-chat-base` 仓库，固定 OpenMausBot OSS 版本；Lodge 不把基座打进仓库。

## 桌面版

Electron 壳只做三件事：启动 Lodge 的 Node 服务、把同源 UI 装进窗口、寻找或启动基座。

- 开发：`npm run desktop`
- 打包：`npm run package:mac`，产物在 `release/`
- 只发 zip，不发 dmg；ad-hoc 签名，不公证，没有自动更新
- 第一次打开被 Gatekeeper 拦下时，到“系统设置 → 隐私与安全性”点“仍要打开”
- Windows/Linux 打包脚本已加，未真机验证

图标：`assets/brand/` 是源文件；`build/icon.png` 与 `build/icon.icns` 用于打包。

## 基座与 CLI

桌面版寻找基座的顺序：

1. `CREW_BASE_URL` 指定的地址
2. `http://127.0.0.1:8799`
3. `LODGE_BASE_DIR`、已保存设置、`~/workspace/crew-chat-base` 或 `Resources/base`

找到基座目录但没运行时，app 会用本机 Node 启动：

```bash
node --experimental-strip-types server/openmausbot.ts serve --port <free> --data-dir <userData>/base-data
```

找不到基座目录时，首次启动会弹出目录选择器。app 不会自动安装 CLI，也不会修改基座目录。

## 内置 runtime

Lodge 不自己发现 agent CLI；发现只有一套：基座按 PATH 和已知安装目录探测，Lodge 只读 `/api/instances`。

桌面版可以随包带一个通用 `runtimes` 目录。当前是 Pi，加其他 CLI 不需要改 Electron 逻辑。

```text
Resources/runtimes/
  pi/
    runtime.json
    pi
    LICENSE
```

`runtime.json` 只声明分发信息：`id`、`name`、`version`、`binary`。登录命令不在这里，而在基座 driver 的 `login` 元数据里；Lodge 只渲染登录按钮。

```bash
npm run prepare:runtimes   # 下载并校验到 build/runtimes/<id>
LODGE_RUNTIMES_DIR=/path/to/runtimes npm run desktop
```

Pi 是 BYOK。登录凭据写到 `~/.pi/agent/auth.json`；登录后重启 Lodge，基座才会重新读取模型目录。没有可用模型时，建房界面会提示登录，不会静默换模型。

## 上下文装配

`server/crew/prompt-context.js` 负责把房间事实裁成提示词：

- 最近发言原文、早期发言摘要、证据摘要、历史阶段摘要各有硬预算；
- 完整日志和 diff 留在证据文件里，提示词只拿摘要和引用；
- 聊天与验收的软预算靠提示词，硬预算由装配器裁剪；
- 大部分输入来自基座线程历史，不是 Lodge 拼的提示词。

## advisor 端口（可选，不在主链路）

advisor 是可选的外部建议端口，只服务**影子评审**：房间开启后，复核时并行取一份对照意见。

- 默认关闭：没有 `ADVISOR_URL` 时客户端返回 `{ available: false, advice: [] }`。
- 只返回建议：`summary`、`reasons`、`risks`、`missingEvidence`；没有分数，没有 verdict。
- 只记录：意见写进房间状态，按阶段覆盖，不进 transcript，不进入验收员提示词，不进入 Gate 决定，也不阻塞验收派发。
- 只在人签字前按需出现：验收卡不展示，人在签字前主动展开才看到。
- 隐私：房间开启影子评审时记录一次外部服务 host 的确认；host 变了要重新确认，否则跳过。第一次调用前还会留一条可见提示，说明证据和 diff 会发给外部服务。
- 房间菜单里的“影子评审…”可以开启、关闭，或在 host 变化后重新确认，不需要重建房间。
- 载荷有上限：目标、阶段、证据文本、命令、diff 和文件清单都会截断；文件产物只送路径、大小和哈希，不送正文。
- 没有配置 `ADVISOR_URL`、调用失败或 host 变了，房间都会收到一条可见提示，不静默失败。
- 意见只在阶段仍处于 active 时落进房间；迟到的意见不会覆盖下一步。
- 失败不阻塞：超时、HTTP 错误、非法 JSON 都 fail soft；调用方不依赖它做决定。
- 边界：不是角色，不写 PASS，不替代验收员。

配置：

```bash
ADVISOR_URL=https://advisor.example/evaluate
ADVISOR_TOKEN=...
ADVISOR_TIMEOUT_MS=8000
```

请求：

```json
{
  "mode": "gate",
  "goal": "目标",
  "roomType": "studio",
  "plan": {},
  "verify": "test",
  "acceptance": "npm test"
}
```

`mode: "review"` 时附带阶段和证据摘要；`stage.manual: true` 表示人工验收，不要要求验收命令。响应支持一条建议或 `{ "advice": [...] }`：

```json
{
  "summary": "建议补一条回滚测试",
  "reasons": ["缺少回滚测试"],
  "risks": ["依赖外部网络"],
  "missingEvidence": ["rollback.log"],
  "model": "advisor-xxx",
  "version": "2026-11"
}
```

本仓库带一个可独立运行的参考服务：

```bash
npm run advisor:serve
ADVISOR_URL=http://127.0.0.1:8798/evaluate
```

- `rules`（默认）：按目标结构、验收命令、证据字段给出具体建议。
- `model`：接 OpenAI 兼容的 chat completions 端点；失败自动回退规则。

它只是端口的一个样例实现，不是产品依赖。

## 数据、日志与恢复

- 源码运行数据：仓库下 `.data/`
- 桌面版数据：`~/Library/Application Support/Lodge/data`
- 基座数据：`~/Library/Application Support/Lodge/base-data`
- 日志：`~/Library/Application Support/Lodge/logs/server.log`
- 帮助菜单：检查更新（GitHub Releases）、打开日志、打开数据目录
- Lodge 服务异常退出会自动重启一次；仍失败时弹错误并指向日志

停止窗口不会删除数据；退出 app 会停止 Lodge 服务和由它启动的基座进程。

## 发布

`.github/workflows/release.yml` 在推送 `v*` 标签时构建 arm64 和 x64 两个 zip，校验 ad-hoc 签名，生成 `SHA256SUMS.txt`，挂到 GitHub Release。也可以手动触发，只产出构建工件，不发布 Release。

当前没有接自动更新；发布后在 GitHub Releases 手动下载替换。没有 Developer ID 签名和公证时，macOS 自动更新无法可靠工作。

## 验证

```bash
npm test
npm run build
npm run prepare:runtimes
npm run package:mac:dir
```

端到端验证需要 Pi 已登录：新建工作室，执行引擎选 Pi，给一条可执行的验收命令，确认执行成员实际跑了命令并产生证据。
