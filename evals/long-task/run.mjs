// 跨轮长期任务评测：每个场景起两个独立进程，中间是一次真正的退出和重开。
// 不调用模型；测的是轮次、恢复、队列、人工门和成本账本，不是单轮聪明。
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SCENARIO_IDS } from './scenarios.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const flag = name => args.includes(name)
const only = option('--case', '')
const keep = flag('--keep')
const outDir = resolve(option('--out', join(root, 'results')))
const timeoutMs = Math.max(10, Number(option('--timeout', '60')) || 60) * 1000
const cases = only === '' ? SCENARIO_IDS : SCENARIO_IDS.filter(id => id === only)
if (cases.length === 0) {
  console.error(`没有这个场景：${only}`)
  process.exit(2)
}

const worker = join(root, 'worker.mjs')

const runPhase = (caseId, phase, dataDir, repo) => {
  const result = spawnSync(process.execPath, [worker, '--case', caseId, '--phase', phase, '--data-dir', dataDir, '--repo', repo], {
    encoding: 'utf8',
    timeout: timeoutMs,
  })
  const line = String(result.stdout ?? '').trim().split('\n').filter(Boolean).at(-1) ?? ''
  let parsed = null
  try { parsed = line === '' ? null : JSON.parse(line) } catch {}
  if (result.status !== 0 || parsed === null) {
    throw new Error(`${caseId}/${phase} 失败：${parsed?.error ?? result.stderr?.trim() ?? `exit ${result.status}`}`)
  }
  return parsed
}

const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))]
}
const median = values => percentile(values, 0.5)

const rows = []
for (const caseId of cases) {
  const dataDir = mkdtempSync(join(tmpdir(), `lodge-long-${caseId}-`))
  const repo = mkdtempSync(join(tmpdir(), `lodge-long-repo-${caseId}-`))
  const startedAt = Date.now()
  try {
    runPhase(caseId, 'first', dataDir, repo)
    const result = runPhase(caseId, 'second', dataDir, repo)
    rows.push({
      case: caseId,
      ok: result.ok === true,
      ms: Date.now() - startedAt,
      rounds: result.rounds ?? 0,
      completed: result.completed ?? 0,
      rework: result.rework ?? 0,
      human: result.human ?? 0,
      costMicroUsd: result.costMicroUsd ?? 0,
    })
    console.log(`${caseId}: PASS · ${Date.now() - startedAt}ms · ${result.rounds ?? 0} 轮`)
  } catch (error) {
    rows.push({ case: caseId, ok: false, ms: Date.now() - startedAt, error: String(error?.message ?? error), rounds: 0, completed: 0, rework: 0, human: 0, costMicroUsd: 0 })
    console.log(`${caseId}: FAIL · ${String(error?.message ?? error)}`)
  } finally {
    if (!keep) {
      rmSync(dataDir, { recursive: true, force: true })
      rmSync(repo, { recursive: true, force: true })
    }
  }
}

const passed = rows.filter(row => row.ok).length
const totalRounds = rows.reduce((sum, row) => sum + row.rounds, 0)
const totalCompleted = rows.reduce((sum, row) => sum + row.completed, 0)
const totalCost = rows.reduce((sum, row) => sum + row.costMicroUsd, 0)
const summary = {
  at: new Date().toISOString(),
  cases: rows.length,
  passed,
  successRate: rows.length === 0 ? 0 : passed / rows.length,
  rounds: totalRounds,
  completed: totalCompleted,
  rework: rows.reduce((sum, row) => sum + row.rework, 0),
  human: rows.reduce((sum, row) => sum + row.human, 0),
  costMicroUsd: totalCost,
  costPerDelivery: totalCompleted === 0 ? null : Math.round(totalCost / totalCompleted),
  p50Ms: median(rows.map(row => row.ms)),
  p95Ms: percentile(rows.map(row => row.ms), 0.95),
  rows,
}
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`)
const lines = [
  '# Long-task eval',
  '',
  `- at: ${summary.at}`,
  `- cases: ${summary.cases}`,
  `- passed: ${summary.passed}/${summary.cases} (${Math.round(summary.successRate * 100)}%)`,
  `- rounds: ${summary.rounds} · completed: ${summary.completed}`,
  `- rework: ${summary.rework} · human: ${summary.human}`,
  `- cost: $${(summary.costMicroUsd / 1_000_000).toFixed(4)} · per delivery ${summary.costPerDelivery === null ? '—' : `$${(summary.costPerDelivery / 1_000_000).toFixed(4)}`}`,
  `- p50: ${summary.p50Ms}ms · p95: ${summary.p95Ms}ms`,
  '',
  '| case | result | ms | rounds | completed | rework | human | cost | error |',
  '|---|---|---:|---:|---:|---:|---:|---:|---|',
  ...rows.map(row => `| ${row.case} | ${row.ok ? 'PASS' : 'FAIL'} | ${row.ms} | ${row.rounds} | ${row.completed} | ${row.rework} | ${row.human} | $${(row.costMicroUsd / 1_000_000).toFixed(4)} | ${row.error ?? ''} |`),
  '',
]
writeFileSync(join(outDir, 'latest.md'), lines.join('\n'))
console.log(`\n${passed}/${rows.length} passed · p50 ${summary.p50Ms}ms · ${join(outDir, 'latest.md')}`)
if (passed !== rows.length) process.exitCode = 1
