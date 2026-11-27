import { join } from 'node:path'

// 打包产物的目录形状是发布契约：冒烟脚本和测试读同一份清单，避免“清单里少一项”。
// 只发 macOS：基座是我们自己的 Rust 可执行文件，随包放在 Resources/base-rs。
export const packageLayout = ({ app }) => {
  const resources = join(app, 'Contents', 'Resources')
  return {
    resources,
    binary: join(app, 'Contents', 'MacOS', 'Lodge'),
    required: [
      'app/server/index.js',
      'app/shared/system-policy.js',
      'app/ui/dist/index.html',
      'base-rs/lodge-base-slice',
      'runtimes/pi/pi',
      'licenses/third_party/OpenMausBot-LICENSE.txt',
    ],
  }
}

export const packageArgs = argv => {
  const at = argv.indexOf('--app')
  const value = at < 0 ? undefined : argv[at + 1]
  return {
    app: typeof value === 'string' && !value.startsWith('--') ? value : 'release/mac-arm64/Lodge.app',
  }
}
