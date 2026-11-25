// 每天用真实模型跑一次完整评测：真实房间、规划、执行、验收探针。
// 用法：npm run nightly:eval:install [-- 03:17]；npm run nightly:eval:uninstall。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { installNightly, parseNightlyAt, uninstallNightly } from './nightly-launchd.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const label = 'com.lodge.eval'
const args = process.argv.slice(2)

try {
  if (args.includes('--uninstall')) {
    const result = uninstallNightly(label)
    console.log(`nightly eval: 已移除 ${result.label}`)
    process.exit(0)
  }
  const when = parseNightlyAt(args, '03:17')
  const result = installNightly({
    root,
    label,
    script: 'nightly-eval.mjs',
    logName: 'eval.log',
    // 晚上关机会错过 03:17；登录时补跑一次，今天已有日报就跳过。
    extraArgs: ['--notify', '--if-due'],
    runAtLoad: true,
    ...when,
  })
  console.log(`nightly eval: 每天 ${String(when.hour).padStart(2, '0')}:${String(when.minute).padStart(2, '0')} 跑一次`)
  console.log(`nightly eval: ${result.plistPath}`)
  console.log(`nightly eval: 日志 ${result.logPath}`)
} catch (error) {
  console.error(`nightly eval: ${error?.message ?? error}`)
  process.exit(1)
}
