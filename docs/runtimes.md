# 内置 runtime

Lodge 不自己发现 agent CLI。发现仍然只有一套：OpenMausBot 基座按 PATH 和已知安装目录探测，Lodge 只读取 `/api/instances`。

桌面版额外随包带一个通用 `runtimes` 目录。当前里面是 Pi，以后加其他 CLI 不需要改 Electron 逻辑。

## 目录与 manifest

```text
Resources/runtimes/
  pi/
    runtime.json
    pi
    LICENSE
```

`runtime.json` 只声明分发信息：

```json
{
  "id": "pi",
  "name": "Pi",
  "version": "1.5.2",
  "binary": "pi"
}
```

“怎么登录”不在这里，而在基座 driver 的 `login` 元数据里：

```ts
login: {
  args: ["auth", "login", "{provider}"],
  prompt: "Pi provider (anthropic / openai / deepseek / ...)",
  note: "完成。重启 Lodge 后 Pi 模型会出现；按回车关闭…"
}
```

基座把这个元数据和实例解析后的 CLI 一起放进 `/api/instances` 的 `login.command`，Lodge 只负责渲染登录按钮并用它打开终端。这样内置 runtime 和用户自己安装的 CLI 走同一套登录描述。

Electron 启动基座时，把每个 runtime 目录合并进 `OMB_EXTRA_PATH`。基座仍然用自己的 `augmentedPath()` 和 driver `snapshot()` 发现它，所以内置 runtime 和用户自己安装的 CLI 走同一条发现链路；只是前者随 app 分发。

## 准备与打包

```bash
npm run prepare:runtimes   # 下载并校验到 build/runtimes/<id>
npm run package:mac        # 先 prepare:runtimes，再打包
```

`prepare:runtimes` 的 runtime 列表和版本在 `scripts/prepare-runtimes.mjs`。默认 Pi 1.5.2；可用 `LODGE_RUNTIME_PI_VERSION` 覆盖单个 runtime 版本，用 `LODGE_RUNTIME_PLATFORM` / `LODGE_RUNTIME_ARCH` 覆盖目标平台。`--force` 强制重新下载。

开发时也可以指定已有 runtime 目录：

```bash
LODGE_RUNTIMES_DIR=/path/to/runtimes npm run desktop
```

如果基座已经在运行，Electron 会复用它，不会重新注入路径；先停止外部基座，或让外部基座的 `OMB_EXTRA_PATH` 指向 `build/runtimes/<id>`。

## Pi 登录

Pi 是 BYOK。首次启动时，如果 Lodge 发现内置 Pi 已可执行但没有模型，会主动问是否登录；也可以稍后在新建房间的“执行引擎”里点“登录 Pi”，或走 `帮助 → Pi 登录…`。这两个入口都来自基座 `/api/instances` 的 `login` 元数据，Lodge 不自己保存登录命令。凭据写到 `~/.pi/agent/auth.json`，登录后重启 Lodge，基座才会重新读取模型目录。

没有可用模型时，新建房间的“执行引擎”仍可选中并显示“未配置模型”，旁边给出登录按钮；登录后重启 Lodge 才能继续建房。登录入口只在 Lodge 桌面版可用；纯浏览器开发模式只显示提示。

有可用模型时，引擎下方会再出现模型下拉。Lodge 把 `{ instanceId, model }` 随执行席位传给基座，基座写入 bot 的 `modelSelection`；模型不在该实例目录里时会在房间里标出降级原因，不会静默换模型。

## 已知边界

Lodge 的执行席位默认 `approval: auto`，Pi 会直接执行工具；`observe` 信任只对会发权限卡的运行时有约束。当前建房界面没有把执行席位改成 `ask` 的开关，所以不要把 `observe` 当作 Pi 的硬只读边界；需要硬限制时应在基座侧限制工具范围或沙箱。

## 验证

```bash
node --test server/crew/engine.test.js
npm run build
npm run prepare:runtimes
npm run package:mac:dir
```

端到端验证需要 Pi 已登录：新建任务房，执行引擎选 Pi，给一条可执行的验收命令，确认执行席位实际跑了命令并产生证据。
