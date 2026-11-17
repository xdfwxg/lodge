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

开发时基座仍是独立的 `crew-chat-base` 仓库；发布包会把它的 `dist-server` 打进去，用户不需要再装仓库或系统 Node。

## 桌面版

Electron 壳只做三件事：启动 Lodge 的 Node 服务、把同源 UI 装进窗口、寻找或启动基座。

- 开发：`npm run desktop`
- 打包：先在 `crew-chat-base` 运行 `pnpm build:server`，再 `npm run package:mac`；脚本会准备 Pi、基座和 UI，产物在 `release/`
- 只发 zip，不发 dmg；ad-hoc 签名，不公证，没有自动更新
- 第一次打开被 Gatekeeper 拦下时，到“系统设置 → 隐私与安全性”点“仍要打开”
- Windows/Linux 打包脚本已加，未真机验证

图标：`assets/brand/` 是源文件；`build/icon.png` 与 `build/icon.icns` 用于打包。

## 基座与 CLI

桌面版寻找基座的顺序：

1. `CREW_BASE_URL` 指定的地址
2. `http://127.0.0.1:8799`
3. `LODGE_BASE_DIR`、已保存设置、`Resources/base`、`~/workspace/crew-chat-base`

发布包里的 `Resources/base` 是已经 bundle 的 `dist-server`，app 用 Electron 自带的 Node 24 启动它：

```bash
ELECTRON_RUN_AS_NODE=1 Lodge Resources/base/openmausbot.js serve --port <free> --data-dir <userData>/base-data
```

只有源码基座才需要系统 Node 24。app 不会自动安装 CLI，也不会修改基座目录。

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

## 工作区与审批边界

工作区不是通用沙箱，边界要说清：

- `CREW_NODE_MODULES_MODE=copy|link|none`，默认 `copy`。`link` 会让写成员穿过 symlink 改到源目录依赖，只适合明确的开发调试。
- `.env` / `.env.local` 只复制给执行成员，不给验收员；验收员仍能读证据和改动，但不应拿到模型服务的密钥。
- 原地目录（direct）没有验收副本：验收员只读、不能 exec；源目录里的文件对验收员仍然可读，敏感项目请用 git 或复制工作区。
- 路径清理只允许在 `CREW_WORKTREE_ROOT` / `CREW_COPY_ROOT` 之下；房间记录损坏也不会删到工作区外。

审批桥是“人确认”的通道，不是命令防火墙：

- 外部动作按命令语义识别，覆盖常见直接写法、`git -C`、`npm --prefix`、`env`/`xargs` 包装等；它仍是尽力而为，不能保证拦住所有等价写法。
- 真正的权限边界是成员的工具面与 `read/exec/write` 声明；exec 本身能执行任意命令。
- pending 审批不会被历史截断；房间断开或过期时会向基座发 deny，不留下永远等待的卡。

## 检查由产品保证（阶段证据）

- 阶段做完，产品从仓库里认检查：`package.json` 的 `test` 脚本（按锁文件选 npm/pnpm/yarn）、`Cargo.toml`、`go.mod`、明确配置的 pytest、`Makefile` 的 `test` 目标。
- 在独立副本里运行，命令、退出码、输出、diff 和改动文件作为证据留在房间。
- 认不出来就写“这一步没有可自动运行的检查”，结果由人确认；不拿空命令为难人。
- 只认明确配置，不猜项目类型；自动检查通过不替代复核和签字。
- 自动检查没通过会自动退回重做：带上命令、退出码、最后一段输出，以及已有影子评审意见；阶段 Gate 拒绝签字。
- 重做是有界循环：同一失败原地再现、超过 3 次、超过 15 分钟或额度用完就停下，写清原因后交给人。
- 停下状态分三种：`blocked`（需要人处理）、`limit-reached`（到时间上限，可以再跑一轮）、`needs-input`（没有自动检查，需要人确认）。
- 重做提示里带前几次的检查结果（命令、退出码、最后一行输出），把房间记录当作进度账本。
- 停止状态写进房间的 `autoCheck`（阶段、状态、第几次/上限、原因、时间）；界面只显示一句人话，细节留在记录里，检查通过后清掉。
- 重做期间不往时间线逐次写系统消息；失败只进证据，通过或停下时各说一句。

## 影子评审（房间内的隐藏 bot，不在主链路）

影子评审是房间里的一个隐藏成员：不占席位、没有工具，复核时和验收派发并行取一份对照意见。它不接外部服务。

- 建房时勾选「影子评审」才会创建；创建后房间拿到 `shadowBot`（基座成员引用），不暴露给界面。
- 它换一个角度看同一步：验收员判“是否达标”，影子评审找“有没有漏”——最可能出错的地方、验收漏掉的场景、一个反例。
- 只回一段 JSON（`summary`、`reasons`、`risks`、`missingEvidence`），写进房间状态，按阶段覆盖；不进 transcript、不进验收员提示词、不进 Gate，也不阻塞验收。
- 只在人签字前按需出现：签字卡里默认折叠，展开才看到。
- 失败不阻塞：bot 不在、超时、回的格式不对，房间只留一句可见提示，验收照常走。
- 边界：不是角色，不写 PASS/REJECT，不打分，不替代验收员。模型暂时和房间共用，以后可以单独换。

## 文案与错误

- 时间线、侧栏、对话框只出现人能看懂的一句话：发生了什么、下一步做什么。
- 系统消息走 `server/crew/notices.js` 的 `systemNotice`：原始错误写进消息的 `meta.detail` 并打一条 `[lodge]` 日志，不拼进正文。
- 界面上的错误走 `ui/src/error-text.js`：中文业务原因保留，英文和网络错误换成固定的人话（`humanErrorText` / `errorSuffix`）。
- 不写实现旁白：“副本、并行、重启后、未启动”这类词不出现，改成“这一步没做成，需要你处理”这类动作句。

## 数据、日志与恢复

- 源码运行数据：仓库下 `.data/`
- 桌面版数据：`~/Library/Application Support/lodge/data`
- 基座数据：`~/Library/Application Support/lodge/base-data`
- 日志：`~/Library/Application Support/lodge/logs/server.log`
- 帮助菜单：检查更新（GitHub Releases）、打开日志、打开数据目录
- Lodge 服务异常退出会自动重启一次；仍失败时弹错误并指向日志

停止窗口不会删除数据；退出 app 会停止 Lodge 服务和由它启动的基座进程。

### 数据真相

SQLite（`crew.db`）是房间、消息、交接和审计事件的唯一真相。`transcript.jsonl` 是逐条 fsync 的崩溃恢复日志和可读镜像，不单独重建整间房。启动时会把“日志已写、库还没写”的消息补进库；已有消息永远以库为准。

- 启动前和每 6 小时留一份 `backups/crew-<时间>-<原因>.db`，保留最近 10 份
- 工具步骤只保留最近 2000 条，审计事件保留最近 5000 条；聊天、证据和结论不自动删
- 启动时检查 `PRAGMA integrity_check`；库损坏会拒绝启动，而不是带着坏数据继续跑
- 数据库带 `PRAGMA user_version`；比当前 Lodge 新的库会拒绝打开

### 从备份恢复

先退出 Lodge，再执行：

```bash
npm run data:restore -- --list
npm run data:restore -- --latest
npm run data:restore -- --backup /path/to/crew-2026-11-16-...db
```

桌面版的数据目录要显式传入：

```bash
npm run data:restore -- --data-dir "$HOME/Library/Application Support/lodge/data" --latest
```

恢复前会先把当前库留一份 `pre-restore` 快照；命令会先校验备份，再替换 `crew.db` 并清掉旧的 WAL。Lodge 还在运行时命令会拒绝执行。

## 发布

`.github/workflows/release.yml` 在推送 `v*` 标签时构建 Mac arm64 zip，并在 Windows/Linux runner 上构建对应安装包，做包内容检查和启动 smoke；Mac zip 校验 ad-hoc 签名并生成 `SHA256SUMS.txt` 挂到 GitHub Release。Windows/Linux 产物先作为构建工件，不做签名和自动更新。

当前没有接自动更新；发布后在 GitHub Releases 手动下载替换。没有 Developer ID 签名和公证时，macOS 自动更新无法可靠工作。

## 验证

```bash
npm test
npm run test:ui          # 构建 UI，跑 Playwright + axe；需要本机 Chrome
npm run build
npm run prepare:runtimes
npm run package:mac:dir
npm run smoke:package -- --app release/mac-arm64/Lodge.app
```

端到端验证需要 Pi 已登录：新建工作室，执行引擎选 Pi，给一条可执行的验收命令，确认执行成员实际跑了命令并产生证据。
