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

- `Lodge-0.0.1-arm64.zip`
- 在 Intel Mac 上执行同一命令会得到 `Lodge-0.0.1-x64.zip`

只发 zip，不发 dmg。macOS 26 会把下载来的未公证 dmg 判成“已损坏”，zip 不会。app 使用 ad-hoc 签名（`identity: '-'`），不需要 Apple 开发者账号，但也没有公证。

第一次打开会被 Gatekeeper 拦下。到“系统设置 → 隐私与安全性”点“仍要打开”，之后可以正常启动。不要用 `xattr` 绕过隔离作为常规安装方式，它只适合本机开发调试。

发布 Release 时，macOS 不会自动更新。应用内的“帮助 → 检查更新”只打开 GitHub Releases 页面，由用户下载新的 zip 并替换 `/Applications/Lodge.app`。

## 图标

- `build/icon-artwork.png`：2000×2000 原图
- `build/icon.png`：1024×1024 圆角版，开发模式 Dock、窗口图标和网页 favicon 使用
- `build/icon.icns`：打包进 `Lodge.app` 的 macOS 图标

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

当前是 ad-hoc 签名，不是 Developer ID 签名，也没有公证。它能避免 Apple 芯片上的“已损坏”提示，但 Gatekeeper 仍会要求用户手动放行。

要变成可无提示安装的正式 Mac 版，需要：

1. Apple Developer Program 的 Developer ID Application 证书；
2. `hardenedRuntime: true` 和 entitlements；
3. `xcrun notarytool submit` 公证全部 zip；
4. `xcrun stapler staple` 装订公证票据；
5. 重新压缩并更新校验和。

把 `electron-builder.yml` 的 `identity` 改为证书名，并提供 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID` 后再打正式包。没有完成这些步骤时，不能宣称已签名、已公证或可无提示安装。

## 自动更新

当前没有接自动更新。macOS 走手动下载替换，和 Claude-Bot 的做法一致。没有 Developer ID 签名和公证时，macOS 自动更新无法可靠工作，Gatekeeper 也会拦截；不能只在配置里加更新地址就宣称可用。正式自动更新需要 Developer ID 签名、公证、GitHub Releases feed、`electron-updater` 和 `latest-mac.yml`。

## 发布

`.github/workflows/release.yml` 在推送 `v*` 标签时构建 arm64 和 x64 两个 zip，校验 ad-hoc 签名，生成 `SHA256SUMS.txt`，然后把它们挂到 GitHub Release。也可以在 Actions 里手动触发，只产出构建工件，不发布 Release。

这个工作流尚未在 GitHub Actions 上实际跑过；本地打包和启动验证过，CI 结果以第一次实际运行为准。

## 数据、日志与恢复

- 数据：`~/Library/Application Support/Lodge/data`
- 基座数据：`~/Library/Application Support/Lodge/base-data`
- 日志：`~/Library/Application Support/Lodge/logs/server.log`
- 帮助菜单：检查更新（GitHub Releases）、打开日志、打开数据目录
- Lodge 服务异常退出会自动重启一次；仍失败时弹错误并指向日志

停止窗口不会删除数据；退出 app 时会停止 Lodge 服务和由它启动的基座进程。
