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

## 基座依赖

桌面版只启动 Lodge 产品层。真正的 CLI 回合仍由独立基座提供，默认地址是 `http://127.0.0.1:8799`。启动前先运行 `crew-chat-base`，或用环境变量改地址：

```bash
CREW_BASE_URL=http://127.0.0.1:8799 npm run desktop
```

桌面版不会把基座或 CLI 打进 app 包；这是产品边界，不是遗漏。

## 数据与日志

- 数据：`~/Library/Application Support/Lodge/data`
- 日志：`~/Library/Application Support/Lodge/logs/server.log`

停止窗口不会删除数据；退出 app 时会停止 Lodge 服务进程。
