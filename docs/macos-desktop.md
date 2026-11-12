# Lodge for macOS

Lodge 的 macOS 桌面版是一个最小 Electron 壳：Electron 启动 Lodge 的 Node 服务，再把同源 UI 装进窗口。它不把基座、CLI 或用户凭据打进包里。

## 开发运行

```bash
npm run desktop
```

它会先构建 `ui/dist`，再启动 Electron。Lodge 服务使用随机空闲端口，数据写到 `~/Library/Application Support/Lodge/data`。

## 打包

```bash
npm run package:mac
```

产物在 `release/`：

- `Lodge-0.0.1-arm64.dmg`
- `Lodge-0.0.1-arm64-mac.zip`

当前是未签名构建。第一次打开如果被 Gatekeeper 拦住，可以在 Finder 里右键打开，或执行：

```bash
xattr -dr com.apple.quarantine /Applications/Lodge.app
```

## Windows / Linux

配置和脚本已加：

```bash
npm run package:win
npm run package:linux
```

Windows 目标为 NSIS，Linux 目标为 AppImage。当前只在 macOS 实跑过；Windows/Linux 没有真机验证，不能宣称已交付。

## 基座与 CLI

桌面版会先找已运行的基座：

1. `CREW_BASE_URL` 指定的地址；
2. `http://127.0.0.1:8799`；
3. `LODGE_BASE_DIR`、已保存设置、`~/workspace/crew-chat-base` 或 `Resources/base` 里的 `crew-chat-base`。

找到基座目录但基座没运行时，app 会用本机 Node 启动：

```bash
node --experimental-strip-types server/openmausbot.ts serve --port <free> --data-dir <userData>/base-data
```

找不到基座目录时，首次启动会弹出目录选择器。基座起来后会检查 `/api/instances`；没有可用 CLI 时给出安装命令并让人选择“继续打开界面”或退出。app 不会自动安装 CLI，也不会修改基座目录。

也可以用环境变量显式指定：

```bash
CREW_BASE_URL=http://127.0.0.1:8799 npm run desktop
LODGE_BASE_DIR=$HOME/workspace/crew-chat-base npm run desktop
```

桌面版不会把基座或 CLI 打进 app 包；这是产品边界，不是遗漏。

## 签名与公证

当前是未签名构建。要分发正式 Mac 版，需要 Developer ID Application 证书，并设置：

```bash
export CSC_LINK=/path/to/developer-id.p12
export CSC_KEY_PASSWORD=...
npm run package:mac
```

签名后还需要 notarization（`APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID`）和 stapling。没有证书时不能宣称已签名或可无提示安装。

## 自动更新

当前没有接自动更新。正式分发前需要一条发布 feed（GitHub Releases）和 `electron-updater`；现在只能手动替换 app。

## 数据、日志与恢复

- 数据：`~/Library/Application Support/Lodge/data`
- 基座数据：`~/Library/Application Support/Lodge/base-data`
- 日志：`~/Library/Application Support/Lodge/logs/server.log`
- 帮助菜单：检查更新（GitHub Releases）、打开日志、打开数据目录
- Lodge 服务异常退出会自动重启一次；仍失败时弹错误并指向日志

停止窗口不会删除数据；退出 app 时会停止 Lodge 服务和由它启动的基座进程。
