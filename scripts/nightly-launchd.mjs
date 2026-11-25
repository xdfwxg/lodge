// macOS launchd 定时任务的唯一装配：冒烟和真实评测共用同一份 plist 生成逻辑。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

const escapeXml = value => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')

export const parseNightlyAt = (args, fallback = '03:17') => {
  const at = args.find(arg => /^\d{1,2}:\d{2}$/.test(arg)) ?? fallback
  const [hour, minute] = at.split(':').map(Number)
  if (!(hour >= 0 && hour < 24 && minute >= 0 && minute < 60)) {
    throw new Error(`时间不对：${at}，用 HH:MM`)
  }
  return { at, hour, minute }
}

const pathsOf = label => ({
  plistPath: join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`),
  logDir: join(homedir(), 'Library', 'Logs', 'Lodge'),
})

const bootout = label => {
  const uid = process.getuid?.()
  spawnSync('launchctl', ['bootout', `gui/${uid}/${label}`], { encoding: 'utf8' })
}

export const uninstallNightly = label => {
  bootout(label)
  const { plistPath } = pathsOf(label)
  if (existsSync(plistPath)) rmSync(plistPath)
  return { label, plistPath }
}

const launchPath = () => [...new Set([
  dirname(process.execPath),
  '/opt/homebrew/bin',
  '/usr/local/bin',
  ...String(process.env.PATH ?? '').split(':').filter(Boolean),
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
])].join(':')

export const installNightly = ({ root, label, script, logName, at, hour, minute, extraArgs = [], runAtLoad = false }) => {
  if (process.platform !== 'darwin') throw new Error('目前只支持 macOS')
  const { plistPath, logDir } = pathsOf(label)
  const logPath = join(logDir, logName)
  mkdirSync(dirname(plistPath), { recursive: true })
  mkdirSync(logDir, { recursive: true })
  writeFileSync(plistPath, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escapeXml(label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>${escapeXml(join(root, 'scripts', script))}</string>
${extraArgs.map(arg => `    <string>${escapeXml(arg)}</string>`).join('\n')}
  </array>
  <key>WorkingDirectory</key><string>${escapeXml(root)}</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${escapeXml(launchPath())}</string></dict>
  <key>StartCalendarInterval</key>
  <dict><key>Hour</key><integer>${hour}</integer><key>Minute</key><integer>${minute}</integer></dict>
  <key>StandardOutPath</key><string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key><string>${escapeXml(logPath)}</string>
  <key>RunAtLoad</key><${runAtLoad ? 'true' : 'false'}/>
</dict>
</plist>
`)
  bootout(label)
  const uid = process.getuid?.()
  const domain = `gui/${uid}`
  let loaded = spawnSync('launchctl', ['bootstrap', domain, plistPath], { encoding: 'utf8' })
  if (loaded.status !== 0) loaded = spawnSync('launchctl', ['load', '-w', plistPath], { encoding: 'utf8' })
  if (loaded.status !== 0) {
    throw new Error(`launchd 没装上：${(loaded.stderr || loaded.stdout || '').trim()}`)
  }
  return { label, plistPath, logPath, at }
}
