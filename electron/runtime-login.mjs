import { join } from 'node:path'
import { loginBinary } from './policy.mjs'

export const shellQuote = value => `'${String(value).replaceAll("'", "'\\''")}'`

export const loginScript = ({ login, binary, note }) => {
  if (typeof binary !== 'string' || binary === '') return null
  if (!Array.isArray(login?.args) || login.args.length === 0) return null
  const needsProvider = login.args.some(arg => arg === '{provider}')
  const args = login.args.map(arg => (arg === '{provider}' ? '"$provider"' : shellQuote(arg)))
  const lines = ['#!/bin/zsh', 'clear']
  if (needsProvider) {
    lines.push(`printf %s ${shellQuote(`${login.prompt ?? 'provider'}: `)}`, 'read provider')
  }
  lines.push([shellQuote(binary), ...args].join(' '))
  lines.push(`printf '\\n%s\\n' ${shellQuote(note ?? login.note ?? '完成，按回车关闭…')}`, 'read', '')
  return { text: lines.join('\n'), file: `${safeRuntimeId(login?.instanceId ?? 'runtime')}-login.command` }
}

export const safeRuntimeId = id => String(id ?? '').replace(/[^\w-]/g, '_')

// 登录入口只做选择，不直接执行；主进程拿结果去开终端或文件夹。
export const loginEntry = ({ instance, bundled, platform = 'darwin', userDataDir, note }) => {
  if (!Array.isArray(instance?.login?.args) || instance.login.args.length === 0) return null
  const binary = loginBinary(
    bundled?.binaryPath
    ?? (Array.isArray(instance.cliCandidates) ? instance.cliCandidates[0] : undefined)
    ?? instance.login.command
    ?? instance.cliDefault,
  )
  if (binary === null) return null
  if (platform !== 'darwin') return { kind: 'folder', path: bundled?.dir ?? userDataDir }
  const script = loginScript({ login: { ...instance.login, instanceId: instance.instanceId }, binary, note })
  if (script === null) return null
  return { kind: 'script', file: join(userDataDir, script.file), text: script.text }
}
