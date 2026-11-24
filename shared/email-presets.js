// 常见邮箱的 SMTP 设置：设置界面只问发件邮箱和应用密码，服务器地址从这里来。
// 认不出服务商时不要猜，交给「服务器设置」让用户自己填。
const PRESETS = [
  {
    domains: ['126.com'],
    label: '126 邮箱',
    host: 'smtp.126.com',
    port: 465,
    secure: true,
    hint: '密码填授权码（邮箱设置里开启 SMTP 服务）。',
  },
  {
    domains: ['163.com', 'yeah.net'],
    label: '网易邮箱',
    host: 'smtp.163.com',
    port: 465,
    secure: true,
    hint: '密码填授权码（邮箱设置里开启 SMTP 服务）。',
  },
  {
    domains: ['qq.com', 'foxmail.com'],
    label: 'QQ 邮箱',
    host: 'smtp.qq.com',
    port: 465,
    secure: true,
    hint: '密码填授权码（邮箱设置里开启 SMTP 服务）。',
  },
  {
    domains: ['139.com'],
    label: '139 邮箱',
    host: 'smtp.139.com',
    port: 465,
    secure: true,
  },
  {
    domains: ['sina.com'],
    label: '新浪邮箱',
    host: 'smtp.sina.com',
    port: 465,
    secure: true,
  },
  {
    domains: ['aliyun.com'],
    label: '阿里邮箱',
    host: 'smtp.aliyun.com',
    port: 465,
    secure: true,
  },
  {
    domains: ['gmail.com'],
    label: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    hint: '密码填应用专用密码，不是 Google 密码。',
  },
  {
    domains: ['outlook.com', 'hotmail.com', 'live.com'],
    label: 'Outlook',
    host: 'smtp-mail.outlook.com',
    port: 587,
    secure: false,
  },
  {
    domains: ['icloud.com', 'me.com'],
    label: 'iCloud',
    host: 'smtp.mail.me.com',
    port: 587,
    secure: false,
    hint: '密码填 App 专用密码，不是 Apple ID 密码。',
  },
]

const domainOf = address => {
  const text = String(address ?? '').trim().toLowerCase()
  const at = text.lastIndexOf('@')
  return at > 0 ? text.slice(at + 1) : ''
}

export const emailPresetOf = address => {
  const domain = domainOf(address)
  if (domain === '') return null
  const preset = PRESETS.find(item => item.domains.includes(domain))
  if (preset === undefined) return null
  return { ...preset, user: String(address).trim() }
}
