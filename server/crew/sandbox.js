import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'

export const networkMode = () => (process.env.CREW_ACCEPTANCE_NETWORK === 'allow' ? 'allow' : 'deny')

const hasCommand = command => {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const unavailable = reason => ({ file: null, args: [], mode: 'unavailable', network: 'none', fs: 'none', error: reason })

const canRun = (file, args) => {
  try {
    execFileSync(file, args, { stdio: 'ignore', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

const providers = new Map()
let darwinProbe
let linuxProbe

const profilePath = path => `"${String(path ?? '').replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`

const darwinProfile = cwd => {
  const writable = [
    cwd,
    tmpdir(),
    '/tmp',
    '/private/tmp',
    process.env.TMPDIR,
    `${homedir()}/.npm`,
    `${homedir()}/.cache`,
    `${homedir()}/.config`,
  ].filter(value => typeof value === 'string' && value !== '')
  return [
    '(version 1)',
    '(allow default)',
    '(deny network*)',
    '(deny file-write*)',
    '(allow file-write*',
    ...writable.map(path => `  (subpath ${profilePath(path)})`),
    '  (literal "/dev/null")',
    '  (literal "/dev/stdout")',
    '  (literal "/dev/stderr")',
    ')',
  ].join('\n')
}

providers.set('darwin', ({ command, cwd }) => {
  if (!existsSync('/usr/bin/sandbox-exec')) return unavailable('macOS sandbox-exec 不可用')
  if (darwinProbe === undefined) {
    darwinProbe = canRun('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', '/bin/sh', '-c', 'true'])
  }
  if (!darwinProbe) return unavailable('macOS sandbox-exec 预检失败；设置 CREW_ACCEPTANCE_NETWORK=allow 明确放行')
  return {
    file: '/usr/bin/sandbox-exec',
    args: ['-p', darwinProfile(cwd ?? process.cwd()), '/bin/sh', '-c', command],
    mode: 'network-fs-deny',
    network: 'deny',
    fs: 'cwd',
  }
})

let linuxBwrapProbe
providers.set('linux', ({ command, cwd }) => {
  const root = cwd ?? process.cwd()
  if (hasCommand('bwrap')) {
    if (linuxBwrapProbe === undefined) {
      linuxBwrapProbe = canRun('bwrap', ['--ro-bind', '/', '/', '--unshare-net', '/bin/true'])
    }
    if (linuxBwrapProbe) {
      return {
        file: 'bwrap',
        args: [
          '--die-with-parent', '--ro-bind', '/', '/',
          '--dev', '/dev', '--proc', '/proc', '--tmpfs', '/tmp',
          '--bind', root, root, '--chdir', root, '--unshare-net',
          '/bin/sh', '-c', command,
        ],
        mode: 'network-fs-deny',
        network: 'deny',
        fs: 'cwd',
      }
    }
  }
  if (!hasCommand('unshare')) return unavailable('Linux 没有可用的 unshare/bwrap；安装 bubblewrap 或 unshare，或设置 CREW_ACCEPTANCE_NETWORK=allow')
  if (linuxProbe === undefined) linuxProbe = canRun('unshare', ['-n', '/bin/sh', '-c', 'true'])
  if (!linuxProbe) return unavailable('Linux unshare 预检失败（可能不允许用户命名空间）；设置 CREW_ACCEPTANCE_NETWORK=allow 明确放行')
  return { file: 'unshare', args: ['-n', '/bin/sh', '-c', command], mode: 'network-deny', network: 'deny', fs: 'none' }
})

// Windows 没有可用的原生 Node 沙箱原语；用 WSL2 里的 bubblewrap 同时隔离网络和文件系统。
// 没有 WSL2 或 bubblewrap 时 fail closed，不拿“进程能跑”冒充隔离。
const windowsCommand = name => {
  try {
    execFileSync('where.exe', [name], { stdio: 'ignore', timeout: 5_000 })
    return true
  } catch {
    return false
  }
}

const wslProbe = args => canRun('wsl.exe', args)

export const createWindowsSandboxProvider = ({ hasCommand = windowsCommand, probe = wslProbe } = {}) => {
  let cached
  return ({ command }) => {
    if (!hasCommand('wsl.exe')) {
      return unavailable('Windows 需要 WSL2（wsl.exe）才能做网络/文件系统隔离；或设置 CREW_ACCEPTANCE_NETWORK=allow 明确放行')
    }
    if (cached === undefined) {
      cached = probe(['-e', 'bwrap', '--ro-bind', '/', '/', '--unshare-net', '/bin/true'])
    }
    if (!cached) {
      return unavailable('WSL2 里没有可用的 bubblewrap（或用户命名空间被禁用）；先安装（如 sudo apt install bubblewrap），或设置 CREW_ACCEPTANCE_NETWORK=allow 明确放行')
    }
    return {
      file: 'wsl.exe',
      args: [
        '-e', 'sh', '-c',
        'exec bwrap --ro-bind / / --dev /dev --proc /proc --tmpfs /tmp --dir /tmp/home --setenv HOME /tmp/home --setenv TMPDIR /tmp --unshare-net --bind "$PWD" "$PWD" --chdir "$PWD" /bin/sh -c "$1"',
        'sh', command,
      ],
      mode: 'wsl-network-fs-deny',
      network: 'deny',
      fs: 'cwd',
    }
  }
}

providers.set('win32', createWindowsSandboxProvider())

export const registerSandboxProvider = (platform, provider) => {
  if (typeof platform !== 'string' || typeof provider !== 'function') throw new Error('sandbox provider 需要平台名和函数')
  providers.set(platform, provider)
}

export const sandboxCapability = (platform = process.platform) => {
  const provider = providers.get(platform)
  if (provider === undefined) return { platform, supported: false, reason: '没有该平台的沙箱适配器' }
  const plan = provider({ command: 'true' })
  return plan.mode === 'unavailable'
    ? { platform, supported: false, reason: plan.error }
    : { platform, supported: true, mode: plan.mode, network: plan.network, fs: plan.fs }
}

const unsandboxedPlan = (command, platform) => (
  platform === 'win32'
    ? { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', command], mode: 'off', network: 'allow', fs: 'none' }
    : { file: '/bin/sh', args: ['-c', command], mode: 'off', network: 'allow', fs: 'none' }
)

// 业务只说“要沙箱”；平台选择与命令包装留在适配器层。
export const planCommand = ({ command, cwd, network = networkMode(), platform = process.platform, provider } = {}) => {
  if (network === 'allow') return unsandboxedPlan(command, platform)
  const selected = provider ?? providers.get(platform)
  if (typeof selected !== 'function') return unavailable(`没有 ${platform} 的沙箱适配器`)
  return selected({ command, cwd, platform })
}
