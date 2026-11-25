// 在本机装一个 launchd 定时任务：每天跑一次真实环境冒烟，不建房间、不调模型。
// 用法：npm run nightly:smoke:install [-- 09:17]；npm run nightly:smoke:uninstall。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installNightly, parseNightlyAt, uninstallNightly } from './nightly-launchd.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const label = 'com.lodge.smoke'
const args = process.argv.slice(2)

try {
  if (args.includes('--uninstall')) {
    const result = uninstallNightly(label)
    console.log(`nightly smoke: 已移除 ${result.label}`)
    process.exit(0)
  }
  const when = parseNightlyAt(args, '09:17')
  const result = installNightly({
    root,
    label,
    script: 'smoke-real.mjs',
    logName: 'smoke.log',
    extraArgs: ['--notify'],
    ...when,
  })
  console.log(`nightly smoke: 每天 ${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')} 跑一次`)
  console.log(`nightly smoke: ${result.plistPath}`)
  console.log(`nightly smoke: 日志 ${result.logPath}`)
} catch (error) {
  console.error(`nightly smoke: ${error?.message ?? error}`)
  process.exit(1)
}
