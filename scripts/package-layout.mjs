import { join } from 'node:path'

// 打包产物的目录形状是发布契约：冒烟脚本和测试读同一份清单，避免“清单里少一项”。
export const packageLayout = ({ platform = 'darwin', app }) => {
  const mac = platform === 'darwin'
  const resources = mac ? join(app, 'Contents', 'Resources') : join(app, 'resources')
  return {
    mac,
    resources,
    binary: mac
      ? join(app, 'Contents', 'MacOS', 'Lodge')
      : join(app, platform === 'win32' ? 'Lodge.exe' : 'lodge'),
    runtimeBinary: platform === 'win32' ? 'pi.exe' : 'pi',
    required: [
      'app/server/index.js',
      'app/shared/system-policy.js',
      'app/ui/dist/index.html',
      'base/dist-server/openmausbot.js',
      `runtimes/pi/${platform === 'win32' ? 'pi.exe' : 'pi'}`,
      'licenses/third_party/OpenMausBot-LICENSE.txt',
    ],
  }
}

export const packageArgs = argv => {
  const option = name => {
    const at = argv.indexOf(name)
    if (at < 0) return undefined
    const value = argv[at + 1]
    return typeof value === 'string' && !value.startsWith('--') ? value : undefined
  }
  return {
    app: option('--app') ?? 'release/mac-arm64/Lodge.app',
    platform: option('--platform') ?? 'darwin',
  }
}
