import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import nodemailer from 'nodemailer'
import { emailPresetOf } from '../../../shared/email-presets.js'

const configPath = () => process.env.LODGE_SMTP_CONFIG || join(homedir(), '.lodge', 'smtp.json')
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const fileSettings = () => {
  const path = configPath()
  if (!existsSync(path)) return {}
  try {
    // 密码在这个文件里；只接受只有当前用户可读的权限。
    if ((statSync(path).mode & 0o077) !== 0) return { error: 'SMTP 配置权限太宽；chmod 600 ~/.lodge/smtp.json' }
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    return {
      url: String(raw?.url ?? '').trim(),
      from: String(raw?.from ?? '').trim(),
      to: String(raw?.to ?? '').trim(),
    }
  } catch {
    return { error: 'SMTP 配置读不出来；检查 ~/.lodge/smtp.json' }
  }
}

export const emailConfigError = () => {
  const file = fileSettings()
  if (file.error !== undefined) return file.error
  const url = String(process.env.LODGE_SMTP_URL ?? file.url ?? '').trim()
  const from = String(process.env.LODGE_EMAIL_FROM ?? file.from ?? '').trim()
  if (url === '' || from === '') return '邮箱还没接上；配置 LODGE_SMTP_URL/LODGE_EMAIL_FROM 或 ~/.lodge/smtp.json'
  return ''
}

export const emailTestRecipient = () => {
  const file = fileSettings()
  return String(process.env.LODGE_EMAIL_TO ?? file.to ?? '').trim()
}

const parsedOf = url => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') return null
    return parsed
  } catch {
    return null
  }
}

// 设置界面只看连接状态和发件人；密码永远不回传。
export const smtpSettingsOf = () => {
  const file = fileSettings()
  if (file.error !== undefined) return { configured: false, error: file.error }
  const url = String(process.env.LODGE_SMTP_URL ?? file.url ?? '').trim()
  const from = String(process.env.LODGE_EMAIL_FROM ?? file.from ?? '').trim()
  const to = String(process.env.LODGE_EMAIL_TO ?? file.to ?? '').trim()
  if (url === '' || from === '') return { configured: false, from, to }
  const parsed = parsedOf(url)
  if (parsed === null) return { configured: false, from, to, error: 'SMTP 地址不对' }
  const secure = parsed.protocol === 'smtps:' || parsed.port === '465'
  return {
    configured: true,
    from,
    to,
    host: parsed.hostname,
    port: Number(parsed.port) || (secure ? 465 : 587),
    secure,
    user: decodeURIComponent(parsed.username),
  }
}

export const saveSmtpSettings = input => {
  const from = String(input?.from ?? '').trim()
  const to = String(input?.to ?? '').trim()
  if (!EMAIL.test(from)) return { error: '发件邮箱不对' }
  if (to !== '' && !EMAIL.test(to)) return { error: '收件邮箱不对' }
  // 常用邮箱不用手填服务器；认不出服务商时才要求展开高级设置。
  const preset = emailPresetOf(from)
  const host = String(input?.host ?? '').trim() || preset?.host || ''
  const requestedPort = Number(input?.port)
  const port = Number.isInteger(requestedPort) && requestedPort > 0 ? requestedPort : (preset?.port ?? NaN)
  if (host === '' || !Number.isInteger(port) || port < 1 || port > 65535) {
    return { error: '没认出这家邮箱；先用 126、163、QQ、Gmail、Outlook 这类常见邮箱' }
  }
  const user = String(input?.user ?? '').trim() || preset?.user || ''
  let password = String(input?.password ?? '')
  const secure = input?.secure === true || preset?.secure === true || port === 465
  const file = fileSettings()
  if (file.error !== undefined) return { error: file.error }
  // 改端口/主机/账号要重新输密码；只改发件人或收件人可以留空。
  if (password === '' && file.url !== undefined) {
    const old = parsedOf(file.url)
    if (old === null || old.hostname !== host || decodeURIComponent(old.username) !== user) {
      return { error: '换了服务器或账号，要重新填应用密码' }
    }
    password = decodeURIComponent(old.password)
  }
  if (user !== '' && password === '') return { error: '填一下应用密码' }
  const auth = user === '' ? '' : `${encodeURIComponent(user)}:${encodeURIComponent(password)}@`
  const url = `${secure ? 'smtps' : 'smtp'}://${auth}${host}:${port}`
  const path = configPath()
  try {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    writeFileSync(path, JSON.stringify({ url, from, to, updatedAt: new Date().toISOString() }, null, 2), { mode: 0o600 })
    chmodSync(path, 0o600)
  } catch {
    return { error: '邮箱配置没能保存' }
  }
  return { settings: smtpSettingsOf() }
}

export const clearSmtpSettings = () => {
  try { rmSync(configPath(), { force: true }) } catch {}
  return { settings: smtpSettingsOf() }
}

// 邮箱只是投递适配器：地址和密码来自本机环境或仅本人可读的本地配置，不进房间、不进提示词。
// 支持 smtp:// 和 smtps://；没有配置时不假装能发。
export const emailConfig = () => {
  const file = fileSettings()
  if (file.error !== undefined) return null
  const url = String(process.env.LODGE_SMTP_URL ?? file.url ?? '').trim()
  const from = String(process.env.LODGE_EMAIL_FROM ?? file.from ?? '').trim()
  if (url === '' || from === '') return null
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'smtp:' && parsed.protocol !== 'smtps:') return null
    const secure = parsed.protocol === 'smtps:' || parsed.port === '465'
    return {
      from,
      transport: {
        host: parsed.hostname,
        port: Number(parsed.port) || (secure ? 465 : 587),
        secure,
        ...(parsed.username === '' ? {} : {
          auth: {
            user: decodeURIComponent(parsed.username),
            pass: decodeURIComponent(parsed.password),
          },
        }),
      },
    }
  } catch {
    return null
  }
}

export const emailReady = () => emailConfig() !== null

export const sendEmail = async ({ to, subject, text }) => {
  const config = emailConfig()
  if (config === null) throw new Error('邮箱还没接上')
  const transport = nodemailer.createTransport(config.transport)
  const info = await transport.sendMail({ from: config.from, to, subject, text })
  return { id: typeof info?.messageId === 'string' ? info.messageId : '' }
}
