import { emailConfigError, emailTestRecipient, sendEmail } from '../server/crew/delivery/email.js'

// 只发一封测试邮件；不打印 SMTP 地址或密码。
const to = String(process.argv[2] ?? emailTestRecipient()).trim()
if (to === '') {
  console.error('没有收件地址：在 ~/.lodge/smtp.json 写 "to"，或运行 npm run smtp:test -- you@example.com')
  process.exit(2)
}
const problem = emailConfigError()
if (problem !== '') {
  console.error(problem)
  process.exit(2)
}
try {
  const sent = await sendEmail({
    to,
    subject: 'Lodge 邮件连接测试',
    text: '这封是 Lodge 的 SMTP 连接测试。收到它，说明邮箱已经接上；可以回房间把承诺设成「发到邮箱」。',
  })
  console.log(`已发到 ${to}${sent.id === '' ? '' : ` · ${sent.id}`}`)
} catch (error) {
  console.error(`没发出去：${error?.message ?? error}`)
  process.exit(1)
}
