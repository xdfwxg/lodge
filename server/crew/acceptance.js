import { spawn } from 'node:child_process'
import { planCommand } from './sandbox.js'

const MAX_OUTPUT = 64 * 1024

const clip = text => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…（输出已截断）` : text)

// 验收命令由房间配置提供，在房间仓库里用登录 shell 之外的 /bin/sh 执行；
// 只记录事实（退出码、输出），不据此推断业务结论。
export const runCommand = ({ command, cwd, env, timeoutMs = 120_000, sandbox = false }) => new Promise(resolve => {
  const started = Date.now()
  const plan = sandbox ? planCommand({ command }) : { file: '/bin/sh', args: ['-c', command], mode: 'off' }
  if (plan.error !== undefined) {
    resolve({ exit: null, output: plan.error, timedOut: false, durationMs: 0, sandbox: plan.mode })
    return
  }
  let output = ''
  let timedOut = false
  const child = spawn(plan.file, plan.args, {
    cwd,
    env: env === undefined ? process.env : { ...process.env, ...env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const collect = chunk => {
    if (output.length < MAX_OUTPUT * 2) output += chunk.toString()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const timer = setTimeout(() => {
    timedOut = true
    // 杀整个进程组，避免 npm test 之类的子进程留下来继续跑。
    try {
      process.kill(-child.pid, 'SIGKILL')
    } catch {
      child.kill('SIGKILL')
    }
  }, timeoutMs)
  const finish = (exit, note) => {
    clearTimeout(timer)
    resolve({
      exit,
      output: clip([output, note].filter(Boolean).join('\n')),
      timedOut,
      durationMs: Date.now() - started,
      sandbox: plan.mode,
    })
  }
  child.on('error', error => finish(null, `无法执行验收命令：${error.message}`))
  child.on('close', (code, signal) => finish(signal === null ? code : null, signal === null ? '' : `命令被信号 ${signal} 终止`))
})
