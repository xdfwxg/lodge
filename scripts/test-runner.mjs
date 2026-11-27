// 测试进程里用本地执行代替基座；生产由组合根把端口指向基座的受限执行。
// 这个文件只在 `node --test` 的 --import 里加载，不进产品路径。
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { setCommandRunner } from '../server/crew/command-runner.js'

const run = promisify(exec)

setCommandRunner(async ({ cwd, command }) => {
  const startedAt = Date.now()
  try {
    const { stdout, stderr } = await run(command, { cwd, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 })
    return { code: 0, timedOut: false, stdout, stderr, durationMs: Date.now() - startedAt }
  } catch (error) {
    return {
      code: Number.isInteger(error?.code) ? error.code : null,
      timedOut: error?.killed === true,
      stdout: String(error?.stdout ?? ''),
      stderr: String(error?.stderr ?? ''),
      durationMs: Date.now() - startedAt,
    }
  }
})
