# 沙箱与读写边界

目标是让「执行官只写自己的工作包、验收员只读自己的副本」由 OS 保证，而不是靠提示词和回合后对账。

**2026-11-25 已落地 macOS Seatbelt 第一版**（基座 `server/bot-box/seatbelt.ts`）：写边界由 OS 强制，HOME 只读、数据目录不可读，自己工作副本和临时目录可写；读和网络仍是共享的。见下文「已落地」。

## 现在的位置

- Lodge 侧已有两层软约束：回合结束后把 git 工作副本里工作包之外的改动退回（[`workspace-guard.js`](../../server/crew/workspace-guard.js)、[`write-boundary.js`](../../server/crew/rooms/studio/write-boundary.js)）；验收员 PASS 时若工具调用引用了别人工作树或集成目录，判定会被退回（[`read-boundary.js`](../../server/crew/rooms/studio/read-boundary.js)）。
- 这两层本身不是沙箱：复制目录和原地目录没有可靠的 diff，写入工作区之外（家目录、`/tmp`、别的绝对路径）也不在退回范围。读取边界现在有三道：工具调用一出现房型守卫就核对并叫停越界的成员（`engine.interruptBot`），回合结束再对账一次，PASS 时再核对证据来源；这些是平台层拦截，不是 OS 隔离。macOS Seatbelt 打开后，写边界由 OS 强制，这三层保留为纵深防御；复制目录和原地目录仍只有对账。
- 基座 OpenMausBot 已有 bot-box：Linux 上用 bubblewrap（user/pid/net/ipc/uts 命名空间）+ seccomp，外加 egress 与 harness 两个 unix socket 门。macOS 现在有 Seatbelt 后端（`server/bot-box/seatbelt.ts`），由 `OMB_BOT_BOX=1` 打开；`OMB_BOT_BOX_HOME_READONLY=1` 让 HOME 只读。基座 `/api/health` 的 `box` 字段回报 `on/off`。

## 已落地（macOS，第一版）

- 检测：`detectBox` 在 darwin 上找 `sandbox-exec`，找到就返回 `seatbelt`；没有就 `no-sandbox-exec`，不静默降级。
- 计划：同一个 `planBox` 的 mounts 翻译成 SBPL——读全开，写只给自己工作副本/工作区/临时目录；HOME 的 bind 降为只读；数据目录的 tmpfs 翻成 deny；每个可写目录的 `.git` 只读；网络共享（没有 egress 门）。
- 路径：同时写原路径和 realpath，覆盖 `/tmp` 与 `/private/tmp`、`/var` 与 `/private/var`。
- 引擎发现：HOME 只读时不再把 HOME 里的程序从服务端 PATH 里剔掉（bot 改不了它们）；这也让 Lodge 的 `~/.local/bin/claude` 能启动。
- 验证：真实 claude CLI 规划 1/1、执行 1/1（证明 verified、边界干净）；直接检查 HOME 写被拒、数据目录读被拒、工作副本写成功。基座 `server/bot-box` 141 条测试、typecheck 和 lint 通过。
- 打开方式：基座启动时带 `OMB_BOT_BOX=1 OMB_BOT_BOX_HOME_READONLY=1`。
- 仍是缺口：读取只屏蔽了数据目录，同房间其他成员的工作副本没有在 OS 层隐藏（基座还没有 per-bot 的 `denyRead` 通道）；网络是共享的，没有 egress 门；Chrome 仍未进沙箱；包级（只允许工作包文件）仍靠回合后对账。

## 参考的设计

- **OpenMausBot bot-box**：每次 spawn 由 `planBox` 生成只读/可写路径和网络策略，bubblewrap 包住整个 agent CLI；需要额外可写目录时用 `lend(botId, threadId, rw)` 临时借出；seccomp 过滤系统调用；网络只留回环门。这是最贴近本项目的结构，Lodge 已经有每成员 worktree，可以直接映射成「自己 RW、别人 RO/不可读、源仓库 RO」。
- **OpenAI Codex CLI**：macOS 用 Seatbelt（`sandbox-exec` + 动态 `.sbpl`），从 `deny default` 起，只放行进程、必要 sysctl 和文件读；写只给 `WRITABLE_ROOT`，`.git` 保持只读并用 canonical 路径防软链；Linux 用 Landlock + seccomp，需要 carveout 时改用 bubblewrap。默认断网。
- **Claude Code sandbox**：Seatbelt / bubblewrap 两层（文件系统 + 网络代理白名单），配置里有 `allowWrite` / `denyWrite` / `allowRead` / `denyRead`、`allowedDomains`，以及 `failIfUnavailable`——沙箱起不来时默认静默降级是个坑，生产场景应 fail closed。它也只包 shell 命令，内置工具和 MCP 不在沙箱内。

## 设计

### 1. 基座：每回合一份沙箱计划

在 bot-box 的 `BoxRequest` 上加三个字段，由 Lodge 在派发时给出：

```js
sandbox: {
  read:  [ownWorktree, sourceRepo, engineInstallRoots, '/usr', '/System', ...],
  write: [ownWorktree, tmpDir],
  denyRead: [...otherWorktrees, roomRepo, '~/.ssh', '~/.aws'],
  network: false,
}
```

- 不传时沿用基座现有行为（旧调用方不变）。
- 传了但平台起不来沙箱时，**拒绝这一回合**，返回可读原因；不回退到无沙箱。这是 Claude Code `failIfUnavailable` 的教训。
- Linux：复用现有 bwrap/seccomp 路径，把 `rw` 换成 plan 里的 write，`denyRead` 映射成 `--ro-bind` 之外的不可见路径；网络继续只留回环门。
- macOS：新增 Seatbelt 后端，生成 `.sbpl`：
  - `(deny default)`
  - 允许进程、必要 IPC/sysctl；
  - `file-read*` 只给 read 列表；
  - `file-write*` 只给 write 列表；
  - `.git` 与源仓库显式只读；
  - 路径先 realpath，防 `/var` 与 `/private/var`、软链绕过；
  - 不配网络规则即断网。

原型（派发给执行官时，`WRITABLE` 为他的 worktree，`DENY` 为其他 worktree 和房间集成目录）：

```scheme
(version 1)
(deny default)
(allow process*)
(allow file-read* (subpath "/usr") (subpath "/System") (subpath "/Library")
                  (subpath "/opt/homebrew") (subpath "/private/tmp")
                  (subpath "ENGINE_INSTALLS") (subpath "OWN_WORKTREE") (subpath "SOURCE_REPO"))
(deny file-read* (subpath "OTHER_WORKTREE") (subpath "ROOM_REPO")
                 (subpath "~/.ssh") (subpath "~/.aws"))
(allow file-write* (subpath "OWN_WORKTREE") (subpath "/private/tmp"))
```

- 后端选择按 `process.platform`：`linux` → bwrap，`darwin` → seatbelt；两者都没有就返回 `unavailable`，由调用方决定是否拒绝回合。

| Lodge 的沙箱计划 | Linux（bwrap/seccomp） | macOS（Seatbelt） |
| --- | --- | --- |
| `write` | `--bind` / `--dev-bind` 可写目录 | `(allow file-write* (subpath …))` |
| `read` | `--ro-bind` | `(allow file-read* (subpath …))` |
| `denyRead` | 不挂载或挂空目录 | `(deny file-read* (subpath …))` |
| `network:false` | `--unshare-net` | 不写 network 规则（`deny default` 已断） |
| 沙箱不可用 | 启动前探测失败 | 启动前探测失败；拒绝回合 |

- 状态进 `/api/config.box`：`configured`、`backend`、`reason`；Lodge 只读这一份，不自己猜。

### 2. Lodge：把工作包翻译成计划

- 派发时用现有的 `allowedFilesFor` 和 `foreignReadsOf` 的同一套路径来源，生成 `sandbox.read/write/denyRead`，作为 bot 或 turn 的设置传给基座。
- 规划师和验收员：`write` 为空，`read` 只含自己的副本；执行官：`write` 只含自己的工作包和 `lodge-proof.json`，`read` 含源仓库和自己的副本。
- 平台自己跑证明和反例时，也用同一份计划包住子进程；证明脚本不再拿到完整家目录和网络。
- 沙箱状态如实显示在房间的内部诊断里；主界面不露「沙箱」这类机制词，只在边界降级时用一句人话说「这次只能事后核对」。

### 3. 保留现有两层

OS 沙箱是主边界，`workspace-guard` 和 `read-boundary` 保留为纵深防御：沙箱被绕过、旧房间没有计划、平台自己跑命令时仍然有账可查。

## 验收

- 单测：plan 生成（自己/别人/源仓库/证明文件）；macOS `.sbpl` 生成与 canonical 路径；`failIfUnavailable` 拒绝回合；Lodge 只读 `box` 状态。
- 探针：执行探针的 `scope-and-proof` 在沙箱开启后仍通过；新增一个故意写 `/tmp` 或读别人副本的用例，必须失败。
- 手工：macOS 上跑一间真实工作室，确认执行官写自己 worktree 成功、写家目录被拒、验收员读别人副本被拒；记录到 `docs/testing/validation.md`。
- 不在 Lodge 业务层重写命名空间或 seccomp；不引入编排框架式的「策略引擎」。

## 参考链接

- [OpenAI Codex CLI sandbox](https://github.com/openai/codex/blob/main/codex-rs/core/README.md)
- [Simon Willison: Codex sandbox investigation](https://simonwillison.net/2025/Nov/9/codex-sandbox-investigation/)
- [Claude Code: Configure the sandboxed Bash tool](https://code.claude.com/docs/en/sandboxing)
- [Anthropic sandbox-runtime](https://www.npmjs.com/package/@anthropic-ai/sandbox-runtime)
