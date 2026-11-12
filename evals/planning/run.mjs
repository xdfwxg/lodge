import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCrewPorts } from '../../server/crew/crew-ports.js'
import { evaluateProposal } from '../../server/crew/planning-eval.js'
import { recommendRoster } from '../../server/crew/roster-recommend.js'
import { createEngine } from '../../server/engine.js'

const root = fileURLToPath(new URL('.', import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const runs = Math.max(1, Number(option('--runs', '1')) || 1)
const only = option('--case', '')
const outDir = resolve(option('--out', join(root, 'results')))
const cases = readdirSync(join(root, 'cases'))
  .filter(name => name.endsWith('.json'))
  .map(name => ({ ...JSON.parse(readFileSync(join(root, 'cases', name), 'utf8')), file: name }))
  .filter(item => only === '' || item.id === only)
if (cases.length === 0) {
  console.error(only === '' ? '没有评测 case' : `没有 case: ${only}`)
  process.exit(2)
}

const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
const engine = createEngine()
const ports = createCrewPorts()
const health = await engine.health()
if (health.ok !== true) {
  console.error(`基座未连接：${health.error ?? '先启动 8799'}`)
  process.exit(2)
}

mkdirSync(outDir, { recursive: true })
const results = []
for (const testCase of cases) {
  const fixture = join(root, 'fixtures', testCase.fixture)
  if (!existsSync(fixture)) {
    console.error(`fixture 不存在：${testCase.fixture}`)
    process.exit(2)
  }
  for (let run = 1; run <= runs; run += 1) {
    const repo = mkdtempSync(join(tmpdir(), `crew-eval-${testCase.id}-`))
    try {
      cpSync(fixture, repo, { recursive: true })
      git(repo, ['init', '-q'])
      git(repo, ['add', '.'])
      git(repo, ['-c', 'user.name=Crew Eval', '-c', 'user.email=crew@localhost', 'commit', '-q', '-m', 'fixture'])
      let result
      try {
        result = await recommendRoster({ engine, body: { goal: testCase.goal, repoPath: repo }, workspace: ports.workspace })
      } catch (error) {
        result = { ok: false, error: String(error?.message ?? error) }
      }
      const report = evaluateProposal(result, testCase.expect ?? {})
      const row = {
        caseId: testCase.id,
        run,
        goal: testCase.goal,
        pass: report.pass,
        score: report.score,
        seats: report.proposal?.seats ?? [],
        questions: report.proposal?.questions ?? [],
        done: report.proposal?.done ?? [],
        acceptance: report.proposal?.acceptance ?? '',
        verify: report.proposal?.verify ?? '',
        why: report.proposal?.why ?? '',
        failures: report.failures,
        error: result?.ok === false ? (result.error ?? result.reason ?? 'unknown') : null,
        proposal: report.proposal,
      }
      results.push(row)
      const seats = row.seats.map(seat => `${seat.role}:${seat.name}`).join(', ') || '—'
      console.log(`${testCase.id} #${run}: ${row.pass ? 'PASS' : 'FAIL'} ${row.score} · seats ${seats} · ${row.acceptance || 'manual'}`)
      for (const failure of row.failures) console.log(`  - ${failure.id}: ${failure.detail}`)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }
}

const at = new Date().toISOString()
const passed = results.filter(item => item.pass).length
const summary = {
  at,
  base: process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799',
  runs,
  cases: results.length,
  passed,
  failed: results.length - passed,
  results,
}
writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`)

const lines = [
  '# Planning eval',
  '',
  `- at: ${at}`,
  `- base: ${summary.base}`,
  `- runs: ${runs}`,
  `- passed: ${passed}/${results.length}`,
  '',
  '| case | run | result | score | seats | questions | acceptance | failures |',
  '|---|---:|---|---:|---|---:|---|---|',
  ...results.map(row => [
    row.caseId,
    row.run,
    row.pass ? 'PASS' : 'FAIL',
    row.score,
    row.seats.map(seat => `${seat.role}:${seat.name}`).join('<br>') || '—',
    row.questions.length,
    row.acceptance === '' ? 'manual' : `\`${row.acceptance}\``,
    row.failures.map(item => item.id).join('<br>') || '—',
  ].map(value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
  '',
  '原始建议见 `latest.json`。这个命令会调用真实基座，不进入 `npm test`。',
  '',
]
writeFileSync(join(outDir, 'latest.md'), lines.join('\n'))
console.log(`\n${passed}/${results.length} passed · ${join(outDir, 'latest.md')}`)
process.exitCode = passed === results.length ? 0 : 1
