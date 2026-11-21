// 横向对比：同一个任务、同一个模型家族，只换编排。
// Lodge 房间 vs Pi 单会话（跨进程续会话） vs Pi 无会话（每轮新进程）。
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanupRoom, runLodgePhase } from './runners/lodge.mjs'
import { runPiPhase } from './runners/pi.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const fixture = join(root, 'fixtures', 'ledger')
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const only = option('--case', '')
const lodge = option('--lodge', 'http://127.0.0.1:8787').replace(/\/+$/, '')
const timeoutMs = Math.max(60, Number(option('--timeout', '900')) || 900) * 1000
const outDir = resolve(option('--out', join(root, 'results')))
const keep = args.includes('--keep')

const PHASES = [
  {
    id: 'phase1',
    prompt: '你在一个 Node 项目里。实现 src/ledger.js 的 add(text) 和 list()，用内存数组保存条目。运行 `node check.mjs phase1` 直到通过。不要修改 check.mjs。',
  },
  {
    id: 'phase2',
    prompt: '继续同一个项目。实现 src/ledger.js 的 remove(index)，保持已有 add/list 行为。运行 `node check.mjs phase2` 直到通过。不要修改 check.mjs。',
  },
  {
    id: 'phase3',
    prompt: '继续同一个项目。新增 bin/ledger.js：`node bin/ledger.js add <text>`、`list`、`remove <index>`，把条目存到 process.env.LEDGER_FILE 或 ./ledger.json 的 JSON 数组。运行 `node check.mjs phase3` 直到通过。不要修改 check.mjs。',
  },
]

const prepareRepo = () => {
  const repo = mkdtempSync(join(tmpdir(), 'lodge-compare-repo-'))
  cpSync(fixture, repo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Compare', '-c', 'user.email=compare@localhost', 'commit', '-q', '-m', 'fixture'], { cwd: repo })
  return repo
}

const median = values => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor((sorted.length - 1) / 2)]
}

const CASES = [
  { id: 'lodge', kind: 'lodge' },
  { id: 'pi-session', kind: 'pi', session: true },
  { id: 'pi-stateless', kind: 'pi', session: false },
].filter(item => only === '' || item.id === only)

const rows = []
for (const testCase of CASES) {
  const repo = prepareRepo()
  const startedAt = Date.now()
  const phases = []
  let roomId = null
  try {
    for (const phase of PHASES) {
      let result = null
      if (testCase.kind === 'lodge') {
        result = await runLodgePhase({ lodge, repo, phase: phase.id, prompt: phase.prompt, roomId, timeoutMs })
        roomId = result.roomId ?? roomId
      } else {
        result = runPiPhase({
          repo,
          phase: phase.id,
          prompt: phase.prompt,
          session: testCase.session ? `compare-${testCase.id}-${startedAt}` : null,
          timeoutMs,
        })
      }
      phases.push({ ...result, phase: phase.id })
      console.log(`${testCase.id} ${phase.id}: ${result.pass ? 'PASS' : 'FAIL'} · ${result.ms}ms`)
      if (testCase.kind === 'lodge' && result.ok !== true) break
    }
  } finally {
    if (!keep) rmSync(repo, { recursive: true, force: true })
  }
  const cleanupErrors = testCase.kind === 'lodge' ? await cleanupRoom({ lodge, roomId }) : []
  const passed = phases.filter(item => item.pass).length
  const row = {
    case: testCase.id,
    ok: passed === PHASES.length,
    passed,
    phases: phases.length,
    ms: Date.now() - startedAt,
    p50PhaseMs: median(phases.map(item => item.ms)),
    rework: phases.reduce((sum, item) => sum + (item.pass ? 0 : 1) + (item.rework ?? 0), 0),
    human: phases.reduce((sum, item) => sum + (item.human ?? 0), 0),
    tokens: phases.reduce((sum, item) => sum + (item.tokens ?? 0), 0),
    costMicroUsd: phases.reduce((sum, item) => sum + (item.costMicroUsd ?? 0), 0),
    cleanupErrors,
    detail: phases,
  }
  rows.push(row)
  console.log(`${testCase.id}: ${row.ok ? 'PASS' : 'FAIL'} · ${row.passed}/${PHASES.length} · ${row.ms}ms`)
}

const passed = rows.filter(row => row.ok).length
const summary = {
  at: new Date().toISOString(),
  lodge,
  cases: rows.length,
  passed,
  rows,
}
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`)
const lines = [
  '# Agent comparison',
  '',
  `- at: ${summary.at}`,
  `- cases: ${summary.cases} · passed: ${summary.passed}/${summary.cases}`,
  `- task: 3-phase ledger, one repo, one process per phase`,
  '',
  '| runner | result | phases | rework | human | tokens | cost | total ms | p50 phase |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|',
  ...rows.map(row => `| ${row.case} | ${row.ok ? 'PASS' : 'FAIL'} | ${row.passed}/${PHASES.length} | ${row.rework} | ${row.human} | ${row.tokens} | $${(row.costMicroUsd / 1_000_000).toFixed(4)} | ${row.ms} | ${row.p50PhaseMs} |`),
  '',
  'Lodge 的 human 是房间显式交给人的次数；Pi CLI 没有人工门，记为 0，不当作优势。',
]
writeFileSync(join(outDir, 'latest.md'), lines.join('\n'))
console.log(`\n${passed}/${rows.length} runners passed · ${join(outDir, 'latest.md')}`)
if (passed !== rows.length) process.exitCode = 1
