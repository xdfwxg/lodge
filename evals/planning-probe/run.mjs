// 规划探针：给一个目标，里面藏着几条不能漏的要求；看规划师写出的契约有没有全部接住。
// 需要 Lodge + 基座在跑；会调用真实模型，不进 check:done。
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vendorOf } from '../probe-vendor.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const flag = name => args.includes(name)
const lodge = option('--lodge', process.env.LODGE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const base = option('--base', process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799').replace(/\/+$/, '')
const runs = Math.max(1, Number(option('--runs', '1')) || 1)
const timeoutMs = Math.max(120, Number(option('--timeout', '900')) || 900) * 1000
const outDir = resolve(option('--out', join(root, 'results')))
const keep = flag('--keep')
const only = option('--case', '')
const plannerEngine = option('--planner-engine', process.env.LODGE_PROBE_PLANNER_ENGINE ?? 'claude')
const plannerModel = option('--planner-model', process.env.LODGE_PROBE_PLANNER_MODEL ?? 'claude-sonnet-5')
const validateOnly = flag('--validate')

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const json = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
  const body = await response.text()
  let parsed = null
  try { parsed = body === '' ? null : JSON.parse(body) } catch {}
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body.slice(0, 300)}`)
  return parsed
}

const FIXTURE = {
  'package.json': JSON.stringify({ name: 'planning-probe', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2),
  'README.md': '# 探针\n\n## 安装\n\n跑 npm install。\n\n## 使用\n\n跑 npm test。\n',
  'src/a.js': 'export const answer = n => (n < 0 ? -1 : 42)\n',
  'test/a.test.js': "import assert from 'node:assert/strict'\nimport test from 'node:test'\nimport { answer } from '../src/a.js'\n\ntest('answer', () => {\n  assert.equal(answer(1), 42)\n})\n",
}

// 每条 checks 是目标里藏着的硬要求；契约正文（含边界、非目标）必须接住。
const allCases = [
  {
    id: 'two-artifacts',
    goal: '在 backup/notes.md 里保存 README 原文，再改写 README.md 的「安装」一节；两个文件都要交。',
    checks: [
      { id: 'backup', test: text => /backup\/notes\.md/.test(text) },
      { id: 'readme', test: text => /README\.md/.test(text) },
      { id: 'install', test: text => /安装/.test(text) },
    ],
  },
  {
    id: 'boundaries',
    goal: '把 src/a.js 的 answer 改成无论正负都返回 42；不新增依赖，不联网，也不要改 package.json。',
    checks: [
      { id: 'target', test: text => /src\/a\.js/.test(text) && /42/.test(text) },
      { id: 'no-dependency', scope: 'rules', test: text => /依赖|dependency/i.test(text) },
      { id: 'no-network', scope: 'rules', test: text => /网络|联网|network/i.test(text) },
      { id: 'keep-manifest', scope: 'rules', test: text => /package\.json/.test(text) },
    ],
  },
  {
    id: 'exact-format',
    goal: '在 answer.txt 里只写 42，不能有其他字符；不要新建别的文件。',
    checks: [
      { id: 'answer-txt', test: text => /answer\.txt/.test(text) && /42/.test(text) },
      { id: 'no-extra-files', scope: 'rules', test: text => /其他文件|别的文件|不新增|不要新建|只.*一个文件/.test(text) },
    ],
  },
].filter(testCase => only === '' || testCase.id === only)

const prepareRepo = testCase => {
  const repo = mkdtempSync(join(tmpdir(), `lodge-planning-${testCase.id}-`))
  for (const [file, content] of Object.entries(FIXTURE)) {
    const target = join(repo, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@localhost', 'commit', '-q', '-m', 'probe fixture'], { cwd: repo })
  return repo
}

const roomStopped = room => (
  ['paused', 'stopped', 'archived'].includes(room?.state) ||
  room?.blocked !== null && room?.blocked !== undefined ||
  room?.mergeConflict !== null && room?.mergeConflict !== undefined ||
  (typeof room?.openQuestion === 'string' && room.openQuestion.trim() !== '') ||
  room?.pendingDecision?.status === 'open' ||
  (room?.messages ?? []).some(message => message.kind === 'conclusion')
)

const planReady = room => (
  room?.plan?.contract !== null && room?.plan?.contract !== undefined &&
  Array.isArray(room?.stages) && room.stages.some(stage => stage.kind === 'deliverable')
)

const waitForPlan = async roomId => {
  const deadline = Date.now() + timeoutMs
  let room = null
  while (Date.now() < deadline) {
    await sleep(3_000)
    let state = null
    try { state = await json(`${lodge}/api/state`) } catch { continue }
    room = state.rooms?.find(item => item.id === roomId) ?? room
    if (room !== null && (planReady(room) || roomStopped(room))) return { room, timedOut: false }
  }
  return { room, timedOut: true }
}

const cleanup = async room => {
  if (room === null || keep) return
  for (const action of ['archive', 'delete']) {
    try {
      await json(`${lodge}/api/rooms/${room.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    } catch {}
  }
}

if (validateOnly) {
  // 夹具本身没有缺陷；validate 只确认仓库能建、目标里的检查项都写成了函数。
  let failed = false
  for (const testCase of allCases) {
    if (!Array.isArray(testCase.checks) || testCase.checks.length === 0) failed = true
    if (/\{\{/.test(testCase.goal)) failed = true
    console.log(`${testCase.id}: ${failed ? 'FAIL' : `ok（${testCase.checks.length} 条隐藏要求）`}`)
  }
  process.exitCode = failed ? 1 : 0
  process.exit()
}

mkdirSync(outDir, { recursive: true })
const state = await json(`${lodge}/api/state`).catch(error => {
  console.error(`Lodge 未连接：${error?.message ?? error}`)
  process.exit(2)
})
const config = await json(`${lodge}/api/config`).catch(() => null)
const baseHealth = await json(`${base}/api/health`).catch(() => null)
const boxMode = baseHealth?.box === 'on' || config?.box === 'on' || config?.box?.configured === true ? 'on' : 'off'
const vendor = vendorOf()
console.log(`Lodge ${lodge} · ${state.rooms?.length ?? 0} 个房间 · 沙箱 ${boxMode} · 真实厂商 ${vendor.label}${vendor.model === '' ? '' : ` · ${vendor.model}`}`)

const results = []
for (const testCase of allCases) {
  for (let run = 1; run <= runs; run += 1) {
    const startedAt = Date.now()
    let repo = null
    let room = null
    let row = null
    try {
      repo = prepareRepo(testCase)
      const created = await json(`${lodge}/api/rooms`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          goal: testCase.goal,
          name: `规划探针 · ${testCase.id} · ${run}`,
          roomType: 'studio',
          repoPath: repo,
          // 只给规划师：这一轮测的是它怎么拆、怎么写契约，不测执行官和验收员。
          members: [{ role: 'lead', name: '规划师', engine: plannerEngine, model: plannerModel }],
        }),
      })
      room = created.room ?? null
      if (room === null) throw new Error('建房没有返回房间')
      const waited = await waitForPlan(room.id)
      room = waited.room ?? room
      const contract = room?.plan?.contract ?? null
      const contractText = contract === null ? '' : JSON.stringify(contract)
      // 约束类要求必须写进边界/非目标/假设，不能只把目标原文抄成一条 outcome。
      const rulesText = contract === null
        ? ''
        : JSON.stringify({
          boundaries: contract.boundaries,
          nonGoals: contract.nonGoals,
          assumptions: contract.assumptions,
        })
      const checks = testCase.checks.map(check => ({
        id: check.id,
        ok: contractText !== '' && check.test(check.scope === 'rules' ? rulesText : contractText),
      }))
      const outcomes = Array.isArray(contract?.outcomes) ? contract.outcomes : []
      const stages = Array.isArray(room?.plan?.stages) ? room.plan.stages : []
      const assigned = new Set(stages.flatMap(stage => (Array.isArray(stage.clauseIds) ? stage.clauseIds : [])))
      const allAssigned = outcomes.length > 0 && outcomes.every(outcome => assigned.has(outcome.id))
      const passed = checks.every(check => check.ok) && allAssigned
      row = {
        caseId: testCase.id,
        run,
        box: boxMode,
        plannerEngine,
        plannerModel,
        roomId: room.id,
        state: room?.state ?? null,
        timedOut: waited.timedOut,
        planApplied: contract !== null,
        outcomes: outcomes.length,
        allAssigned,
        checks,
        missing: checks.filter(check => !check.ok).map(check => check.id),
        outcome: passed ? 'ok' : contract === null ? 'no-plan' : 'missed',
        tokens: room.usage?.tokens ?? null,
        costMicroUsd: Number.isFinite(room.usage?.costMicroUsd) ? room.usage.costMicroUsd : null,
        costStatus: room.usage?.costStatus ?? 'unknown',
        elapsedMs: Date.now() - startedAt,
      }
    } catch (error) {
      row = { caseId: testCase.id, run, plannerEngine, plannerModel, roomId: room?.id ?? null, outcome: 'error', error: String(error?.message ?? error), elapsedMs: Date.now() - startedAt }
    } finally {
      if (room !== null) await cleanup(room)
      if (repo !== null) rmSync(repo, { recursive: true, force: true })
    }
    results.push(row)
    console.log(`${testCase.id} #${run}: ${row.outcome}${row.missing?.length ? ` · 漏了 ${row.missing.join('、')}` : ''}${row.error ? ` · ${row.error}` : ''}`)
  }
}

const rate = (part, total) => (total === 0 ? null : `${Math.round((part / total) * 100)}%`)
const percentile = (values, at) => {
  const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((at / 100) * sorted.length) - 1))]
}
const okRows = results.filter(row => row.outcome === 'ok')
const modelRows = results.filter(row => row.plannerModel !== undefined)
const models = [...new Set(modelRows.map(row => `${row.plannerEngine}:${row.plannerModel}`))]
const perModel = models.map(key => {
  const rows = modelRows.filter(row => `${row.plannerEngine}:${row.plannerModel}` === key)
  const ok = rows.filter(row => row.outcome === 'ok').length
  const planned = rows.filter(row => row.planApplied === true).length
  return { key, total: rows.length, ok, planned }
})
const p50 = percentile(results.map(row => row.elapsedMs), 50)
const p95 = percentile(results.map(row => row.elapsedMs), 95)
const reported = results.filter(row => row.costStatus !== 'unknown' && Number.isFinite(row.costMicroUsd))
const costMicroUsd = reported.reduce((sum, row) => sum + (row.costMicroUsd ?? 0), 0)
const stamp = new Date().toISOString()
const md = [
  `# 规划探针 · ${stamp}`,
  '',
  `- 规划模型：${plannerEngine} (${plannerModel}) · 真实厂商：${vendor.label}${vendor.model === '' ? '' : ` · ${vendor.model}`} · Lodge ${lodge} · 沙箱 ${boxMode}`,
  `- 有效样本：${results.length} · 完整接住隐藏要求：${okRows.length}（${rate(okRows.length, results.length) ?? '—'}）`,
  `- 契约已提交：${results.filter(row => row.planApplied === true).length} · 未提交：${results.filter(row => row.outcome === 'no-plan').length}`,
  `- 成本：${reported.length === 0 ? '未报告' : `$${(costMicroUsd / 1_000_000).toFixed(4)}（${reported.length}/${results.length} 间报告）`} · 耗时 p50 ${p50 ?? '—'}ms / p95 ${p95 ?? '—'}ms`,
  '',
  '## 按规划模型',
  '',
  '| 模型 | 样本 | 契约已提交 | 全部接住 |',
  '| --- | --- | --- | --- |',
  ...perModel.map(item => `| ${item.key} | ${item.total} | ${item.planned} | ${item.ok}（${rate(item.ok, item.total) ?? '—'}） |`),
  '',
  '| 用例 | 轮次 | 契约 | 条款分配 | 漏掉的要求 | 结果 | 房间 | 耗时 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map(row => `| ${row.caseId} | ${row.run} | ${row.planApplied === true ? '有' : '无'} | ${row.allAssigned === true ? '齐' : row.allAssigned === false ? '缺' : '—'} | ${row.missing?.join('、') ?? '—'} | ${row.outcome}${row.error ? `：${row.error}` : ''} | ${row.roomId ?? '—'} | ${row.elapsedMs}ms |`),
  '',
  '> 探针只看契约有没有接住目标里的硬要求；方案好坏、执行和验收不在这一项里。',
].join('\n')
writeFileSync(join(outDir, 'latest.md'), `${md}\n`)
writeFileSync(join(outDir, `probe-${Date.now()}.json`), `${JSON.stringify({ stamp, lodge, vendor, boxMode, results }, null, 2)}\n`)
console.log(`\n${md}`)
process.exitCode = okRows.length === results.length ? 0 : 1
