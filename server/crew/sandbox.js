import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'

export const networkMode = () => (process.env.CREW_ACCEPTANCE_NETWORK === 'allow' ? 'allow' : 'deny')

const hasCommand = command => {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${command} >/dev/null 2>&1`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const unavailable = reason => ({ file: null, args: [], mode: 'unavailable', error: reason })

const providers = new Map()

providers.set('darwin', ({ command }) => {
  if (!existsSync('/usr/bin/sandbox-exec')) return unavailable('macOS sandbox-exec 不可用')
  return {
    file: '/usr/bin/sandbox-exec',
    args: ['-p', '(version 1)(allow default)(deny network*)', '/bin/sh', '-c', command],
    mode: 'network-deny',
  }
})

providers.set('linux', ({ command }) => {
  if (!hasCommand('unshare')) return unavailable('Linux 没有可用的 unshare；安装 unshare/bwrap 或设置 CREW_ACCEPTANCE_NETWORK=allow')
  return { file: 'unshare', args: ['-n', '/bin/sh', '-c', command], mode: 'network-deny' }
})

providers.set('win32', () => unavailable('Windows 网络沙箱尚未接入；需要 AppContainer/Job Object + WFP/Firewall 适配器，或设置 CREW_ACCEPTANCE_NETWORK=allow'))

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
    : { platform, supported: true, mode: plan.mode }
}

// 业务只说“要沙箱”；平台选择与命令包装留在适配器层。
export const planCommand = ({ command, network = networkMode(), platform = process.platform, provider } = {}) => {
  if (network === 'allow') return { file: '/bin/sh', args: ['-c', command], mode: 'off' }
  const selected = provider ?? providers.get(platform)
  if (typeof selected !== 'function') return unavailable(`没有 ${platform} 的沙箱适配器`)
  return selected({ command, platform })
}
