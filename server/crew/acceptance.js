import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const MAX_OUTPUT = 64 * 1024
const MAX_BUFFER = 8 * 1024 * 1024

const clip = text => (text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n…（输出已截断）` : text)

const git = async (args, cwd) => {
  try {
    const { stdout } = await exec('git', args, { cwd, timeout: 20_000, maxBuffer: MAX_BUFFER })
    return stdout
  } catch (error) {
    return typeof error?.stdout === 'string' ? error.stdout : ''
  }
}

// 验收命令由房间配置提供，在房间仓库里用登录 shell 之外的 /bin/sh 执行；
// 只记录事实（退出码、输出），不据此推断业务结论。
export const runCommand = ({ command, cwd, timeoutMs = 120_000 }) => new Promise(resolve => {
  const started = Date.now()
  let output = ''
  let timedOut = false
  const child = spawn('/bin/sh', ['-c', command], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] })
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
    })
  }
  child.on('error', error => finish(null, `无法执行验收命令：${error.message}`))
  child.on('close', (code, signal) => finish(signal === null ? code : null, signal === null ? '' : `命令被信号 ${signal} 终止`))
})

// 并行执行的集成 diff：从派发时的基准提交到合并后的 HEAD。
export const collectRange = async ({ cwd, base }) => {
  if (typeof base !== 'string' || base === '') return { diff: '', files: [] }
  const scope = ['.', ':(exclude).crew']
  const diff = await git(['diff', `${base}..HEAD`, '--no-color', '--relative', '--', ...scope], cwd)
  const files = (await git(['diff', '--name-only', '--relative', `${base}..HEAD`, '--', ...scope], cwd))
    .split('\n')
    .filter(Boolean)
  return { diff: clip(diff), files }
}

export const collectDiff = async cwd => {
  // 房间自己的运行记录不是交付内容，不进入验收 diff。
  const scope = ['.', ':(exclude).crew']
  const status = (await git(['status', '--porcelain', '--', ...scope], cwd)).trim()
  if (status === '') return { diff: '', status: '', note: '', files: [] }

  const inside = (await git(['rev-parse', '--is-inside-work-tree'], cwd)).trim()
  if (inside !== 'true') return { diff: '', status, note: '工作目录不是 git 仓库，无法生成 diff', files: [] }

  let diff = await git(['diff', 'HEAD', '--no-color', '--relative', '--', ...scope], cwd)
  const tracked = (await git(['diff', 'HEAD', '--name-only', '--relative', '--', ...scope], cwd))
    .split('\n')
    .filter(Boolean)
  const untracked = (await git(['ls-files', '--others', '--exclude-standard', '--', ...scope], cwd))
    .split('\n')
    .filter(Boolean)
  for (const file of untracked.slice(0, 20)) {
    diff += await git(['diff', '--no-index', '--no-color', '/dev/null', file], cwd)
  }
  const note = untracked.length > 20 ? `未跟踪文件 ${untracked.length} 个，diff 只取前 20 个` : ''
  return { diff: clip(diff), status, note, files: [...new Set([...tracked, ...untracked])].slice(0, 200) }
}
