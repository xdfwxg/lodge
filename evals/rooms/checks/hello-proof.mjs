// 独立尺子：文件内容、检查器口径（cwd，不是脚本位置）、证明能在干净副本里重跑。
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const repo = process.argv[2]
const report = { pass: false, detail: '', facts: {} }
const run = (command, cwd) => spawnSync('sh', ['-c', command], { cwd, encoding: 'utf8', timeout: 60_000 })

// 验收员副本、复核副本在复核完成前本来就没有交付：这不是失败，是“这一份还没就绪”。
// 标出来让尺子去试下一份，别把没就绪的副本当成交付不合格。
if (!existsSync(join(repo, 'hello.txt')) || !existsSync(join(repo, 'lodge-proof.json'))) {
  console.log(JSON.stringify({ pass: false, absent: true, detail: '这一份副本里还没有交付', facts: {} }))
  process.exit(0)
}

try {
  const hello = readFileSync(join(repo, 'hello.txt'), 'utf8')
  const checker = readFileSync(join(repo, 'tools', 'check.mjs'), 'utf8')
  const proof = JSON.parse(readFileSync(join(repo, 'lodge-proof.json'), 'utf8'))
  const failures = []
  if (hello.trim() !== 'hello lodge') failures.push('hello.txt 内容不是 hello lodge')
  if (/import\.meta\.url|__dirname|fileURLToPath/.test(checker)) failures.push('检查器按脚本位置推根，不是 process.cwd()')
  if (!/process\.cwd\(\)/.test(checker)) failures.push('检查器没有用 process.cwd() 当根')

  const rootRun = run('node tools/check.mjs', repo)
  if (rootRun.status !== 0) failures.push(`检查器在仓库根没有退出 0（${rootRun.status}）`)

  // 干净副本里重跑证明：entry 和每条 step 都要退出 0。
  const clean = mkdtempSync(join(tmpdir(), 'hello-proof-clean-'))
  cpSync(repo, clean, { recursive: true, filter: source => !source.includes('/.git') })
  const entry = typeof proof.entry === 'string' ? proof.entry : ''
  if (entry === '') failures.push('lodge-proof.json 没有 entry')
  else if (run(entry, clean).status !== 0) failures.push(`entry 在干净副本里没有退出 0：${entry}`)
  const steps = Array.isArray(proof.steps) ? proof.steps : []
  for (const step of steps) {
    // step 写成字符串或 { run } 都行；带 clause 的旧写法也认，只取命令本身。
    const command = typeof step === 'string' ? step : (typeof step?.run === 'string' ? step.run : '')
    if (command.trim() === '') {
      failures.push('证明里有不是命令的 step')
      continue
    }
    if (run(command, clean).status !== 0) failures.push(`step 在干净副本里没有退出 0：${command}`)
  }
  rmSync(clean, { recursive: true, force: true })

  // 反例：改坏内容，检查器必须红。
  const wrong = mkdtempSync(join(tmpdir(), 'hello-proof-wrong-'))
  cpSync(repo, wrong, { recursive: true, filter: source => !source.includes('/.git') })
  writeFileSync(join(wrong, 'hello.txt'), 'hello wrong\n')
  if (run('node tools/check.mjs', wrong).status === 0) failures.push('内容错了检查器还通过')
  rmSync(wrong, { recursive: true, force: true })

  report.facts = { steps: steps.length, entry }
  report.pass = failures.length === 0
  report.detail = report.pass ? '文件齐、检查器按 cwd、证明在干净副本里全部通过' : failures.join('；')
} catch (error) {
  report.detail = String(error?.message ?? error)
}

console.log(JSON.stringify(report))
process.exit(report.pass ? 0 : 1)
