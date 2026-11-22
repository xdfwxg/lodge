// 在本机装一个 launchd 定时任务：每天跑一次真实环境冒烟，不建房间、不调模型。
// 用法：npm run nightly:smoke:install [-- 09:17]；npm run nightly:smoke:uninstall。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const label = 'com.lodge.smoke'
const plistPath = join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`)
const logDir = join(homedir(), 'Library', 'Logs', 'Lodge')
const logPath = join(logDir, 'smoke.log')
const args = process.argv.slice(2)

if (process.platform !== 'darwin') {
  console.error('nightly smoke: 目前只支持 macOS')
  process.exit(1)
}

const uid = process.getuid?.()
const domain = `gui/${uid}`
const uninstall = args.includes('--uninstall')

const bootout = () => spawnSync('launchctl', ['bootout', `${domain}/${label}`], { encoding: 'utf8' })

if (uninstall) {
  bootout()
  if (existsSync(plistPath)) rmSync(plistPath)
  console.log(`nightly smoke: 已移除 ${label}`)
  process.exit(0)
}

const at = args.find(arg => /^\d{1,2}:\d{2}$/.test(arg)) ?? '09:17'
const [hour, minute] = at.split(':').map(Number)
if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60)) {
  console.error(`nightly smoke: 时间不对：${at}，用 HH:MM`)
  process.exit(1)
}

const escapeXml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

mkdirSync(dirname(plistPath), { recursive: true })
mkdirSync(logDir, { recursive: true })
writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(join(root, 'scripts', 'smoke-real.mjs'))}</string>
    <string>--notify</string>
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(root)}</string>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
`)

bootout()
let loaded = spawnSync('launchctl', ['bootstrap', domain, plistPath], { encoding: 'utf8' })
if (loaded.status !== 0) loaded = spawnSync('launchctl', ['load', '-w', plistPath], { encoding: 'utf8' })
if (loaded.status !== 0) {
  console.error(`nightly smoke: launchd 没装上：${(loaded.stderr || loaded.stdout || '').trim()}`)
  process.exit(1)
}
console.log(`nightly smoke: 每天 ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} 跑一次`)
console.log(`nightly smoke: ${plistPath}`)
console.log(`nightly smoke: 日志 ${logPath}`)
