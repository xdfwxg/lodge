// 房间级固定题：真实建房、真实成员、真实验收，再由一把独立尺子核对产出。
// 需要 Lodge 正在运行（默认 8787）；会调用真实模型，不进入 npm test。
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'
import { memoryKeyFor } from '../../server/crew/memory.js'
import { scratchRoot } from '../../server/crew/workspace-git.js'
import { compareRuns } from './compare.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const flag = name => args.includes(name)
const list = value => value.split(',').map(item => item.trim()).filter(item => item !== '')
const lodge = option('--lodge', process.env.LODGE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const runs = Math.max(1, Number(option('--runs', '1')) || 1)
const only = option('--case', '')
const timeoutMs = Math.max(60, Number(option('--timeout', '1200')) || 1200) * 1000
const engines = list(option('--engine', ''))
const models = list(option('--model', ''))
const memories = list(option('--memory', 'off'))
const dataDir = resolve(option('--data-dir', process.env.CREW_DATA_DIR ?? join(root, '..', '..', '.data')))
const baselinePath = option('--baseline', '')
const keep = flag('--keep')
const validate = flag('--validate')
const outDir = resolve(option('--out', join(root, 'results')))
if (memories.some(mode => !['off', 'seeded'].includes(mode))) {
  console.error('--memory 只接受 off 或 seeded')
  process.exit(2)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const json = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
  const body = await response.text()
  let parsed = null
  try { parsed = body === '' ? null : JSON.parse(body) } catch {}
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body.slice(0, 300)}`)
  return parsed
}

const cases = readdirSync(join(root, 'cases'))
  .filter(name => name.endsWith('.json'))
  .map(name => ({ ...JSON.parse(readFileSync(join(root, 'cases', name), 'utf8')), file: name }))
  .filter(item => only === '' || item.id === only)
if (cases.length === 0) {
  console.error(only === '' ? '没有评测 case' : `没有 case: ${only}`)
  process.exit(2)
}

const fixtureOf = testCase => join(root, 'fixtures', testCase.fixture)
const checkOf = testCase => join(root, 'checks', testCase.check)

const git = (cwd, argv) => execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

const prepareRepo = testCase => {
  const fixture = fixtureOf(testCase)
  if (!existsSync(fixture)) throw new Error(`fixture 不存在：${testCase.fixture}`)
  const repo = mkdtempSync(join(tmpdir(), `lodge-eval-${testCase.id}-`))
  cpSync(fixture, repo, { recursive: true })
  git(repo, ['init', '-q'])
  git(repo, ['add', '.'])
  git(repo, ['-c', 'user.name=Lodge Eval', '-c', 'user.email=eval@localhost', 'commit', '-q', '-m', 'fixture'])
  return repo
}

const runCheck = (checkPath, candidates) => {
  const attempts = []
  for (const repo of candidates) {
    if (typeof repo !== 'string' || repo === '' || !existsSync(repo)) continue
    const result = spawnSync(process.execPath, [checkPath, repo], { encoding: 'utf8', timeout: 60_000 })
    const line = String(result.stdout ?? '').trim().split('\n').filter(item => item !== '').at(-1) ?? ''
    let report = null
    try { report = JSON.parse(line) } catch {}
    attempts.push({ repo, status: result.status, report, stderr: String(result.stderr ?? '').slice(0, 500) })
    if (report?.pass === true) return { pass: true, repo, report, attempts }
  }
  const last = attempts.at(-1) ?? null
  return {
    pass: false,
    repo: last?.repo ?? null,
    report: last?.report ?? { pass: false, detail: last?.stderr || '检查没有输出结果', facts: {} },
    attempts,
  }
}

if (validate) {
  let failed = false
  for (const testCase of cases) {
    const repo = prepareRepo(testCase)
    try {
      const check = runCheck(checkOf(testCase), [repo])
      const acceptance = spawnSync('sh', ['-c', testCase.acceptance], { cwd: repo, encoding: 'utf8', timeout: 60_000 })
      // 有一类题故意给一份弱检查，考验收员按目标原文判；只有题面声明过才放过。
      const weakOnPurpose = testCase.weakAcceptance === true
      const acceptanceLine = acceptance.status === 0
        ? weakOnPurpose ? ' expected（本题故意留弱检查）' : ' FAIL（原样就绿，弱检查）'
        : ' ok'
      console.log(`${testCase.id}: 独立尺子${check.pass ? ' FAIL（原样就通过，题太简单）' : ' ok（原样不通过）'} · 自带验收${acceptanceLine}`)
      if (check.pass) failed = true
      if (acceptance.status === 0 && !weakOnPurpose) failed = true
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }
  process.exitCode = failed ? 1 : 0
  process.exit()
}

const health = await json(`${lodge}/api/state`).catch(error => {
  console.error(`Lodge 未连接：${error?.message ?? error}`)
  process.exit(2)
})
console.log(`Lodge ${lodge} · ${health.rooms?.length ?? 0} 个房间 · 引擎 ${(health.engines ?? []).filter(item => item.available).map(item => item.id).join(', ') || '无'}`)

const variants = []
for (const engine of engines.length === 0 ? [null] : engines) {
  for (const model of models.length === 0 ? [null] : models) {
    for (const memory of memories) {
      variants.push({
        engine,
        model,
        memory,
        label: `${engine ?? 'auto'}${model === null ? '' : `/${model}`}${memory === 'seeded' ? ' · 有记忆' : ''}`,
      })
    }
  }
}
// 直接给这个临时工作区放一条已发布记忆，测「记得住」带来的差别；不经过模型写入。
const seedMemory = (testCase, repo, key) => {
  const seed = testCase.memorySeed ?? {}
  const dir = join(dataDir, 'memory')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${memoryKeyFor({ sourceRepo: repo })}.jsonl`)
  const now = Date.now()
  const roomId = `eval-memory-${key}`
  const record = {
    version: 1,
    kind: 'memory',
    roomId,
    roomName: '评测记忆',
    goal: seed.goal ?? testCase.goal,
    conclusion: seed.conclusion ?? '上一次已经交付过同类任务。',
    stages: [],
    files: Array.isArray(seed.files) ? seed.files : [],
    rejections: Array.isArray(seed.rejections) ? seed.rejections : [],
    progress: { done: [], remaining: [], next: null },
    commit: null,
    commitSource: null,
    completedAt: now,
    verdict: { pass: true, reason: '上次交付通过' },
    source: { kind: 'room', roomId },
  }
  writeFileSync(file, `${JSON.stringify(record)}\n${JSON.stringify({ kind: 'review', memoryId: roomId, decision: 'approve', at: now })}\n`)
  return file
}

const membersOf = variant => (
  variant.engine === null && variant.model === null
    ? undefined
    : ['lead', 'worker', 'verifier'].map(role => ({
      role,
      ...(variant.engine === null ? {} : { engine: variant.engine }),
      ...(variant.model === null ? {} : { model: variant.model }),
    }))
)

const verdictsOf = room => (room.messages ?? []).filter(message => message.kind === 'verdict')
const roomDone = room => (
  (room.state === 'idle' && ['completed', 'rejected', 'failed', 'stopped'].includes(room.workRound?.status)) ||
  (room.messages ?? []).some(message => message.kind === 'conclusion')
)
// 只有 completed 才算交付；rejected/failed/stopped 只是等待结束，不是成功。
const roomCompleted = room => room.state === 'idle' && room.workRound?.status === 'completed'
const roomStopped = room => (
  ['paused', 'stopped', 'archived'].includes(room.state) ||
  room.blocked !== null && room.blocked !== undefined ||
  room.mergeConflict !== null && room.mergeConflict !== undefined ||
  (typeof room.openQuestion === 'string' && room.openQuestion.trim() !== '') ||
  room.pendingDecision?.status === 'open'
)

const waitForRoom = async roomId => {
  const deadline = Date.now() + timeoutMs
  let room = null
  while (Date.now() < deadline) {
    await sleep(3_000)
    let state = null
    try { state = await json(`${lodge}/api/state`) } catch { continue }
    room = state.rooms?.find(item => item.id === roomId) ?? room
    if (room !== null && (roomDone(room) || roomStopped(room))) return { room, timedOut: false }
  }
  return { room, timedOut: true }
}

const cleanup = async room => {
  if (room === null || keep) return []
  const errors = []
  for (const action of ['archive', 'delete']) {
    try {
      await json(`${lodge}/api/rooms/${room.id}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    } catch (error) {
      errors.push(`${action}: ${String(error?.message ?? error).slice(0, 120)}`)
    }
  }
  const short = String(room.id ?? '').replace(/^room-/, '')
  if (/^[a-z0-9]{4,16}$/.test(short)) {
    const worktree = join(scratchRoot(), short)
    try { if (existsSync(worktree)) rmSync(worktree, { recursive: true, force: true }) } catch (error) {
      errors.push(`worktree: ${String(error?.message ?? error).slice(0, 120)}`)
    }
  }
  const source = room.sourceRepo ?? room.repoPath ?? ''
  if (typeof source === 'string' && source !== '') {
    try {
      const file = join(dataDir, 'memory', `${memoryKeyFor({ sourceRepo: source })}.jsonl`)
      if (existsSync(file)) rmSync(file)
    } catch {}
  }
  return errors
}

let baseline = null
if (baselinePath !== '') {
  try {
    baseline = JSON.parse(readFileSync(resolve(baselinePath), 'utf8'))
  } catch (error) {
    console.error(`基线读不了：${String(error?.message ?? error)}`)
    process.exit(2)
  }
}

mkdirSync(outDir, { recursive: true })
const results = []
for (const testCase of cases) {
  for (const variant of variants) {
    for (let run = 1; run <= runs; run += 1) {
      const startedAt = Date.now()
      let repo = null
      let room = null
      let created = null
      let seedFile = null
      let row = null
      try {
        repo = prepareRepo(testCase)
        if (variant.memory === 'seeded') {
          seedFile = seedMemory(testCase, repo, `${testCase.id}-${run}-${startedAt}`)
        }
        const body = {
          goal: testCase.goal,
          name: `评测 · ${testCase.id} · ${run}`,
          roomType: 'studio',
          verify: 'test',
          acceptance: testCase.acceptance,
          repoPath: repo,
        }
        const members = membersOf(variant)
        if (members !== undefined) body.members = members
        created = await json(`${lodge}/api/rooms`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        room = created.room ?? null
        if (room === null) throw new Error('建房没有返回房间')
        const waited = await waitForRoom(room.id)
        room = waited.room ?? room
        const check = runCheck(checkOf(testCase), [
          room.repoPath,
          ...Object.values(room.worktrees ?? {}),
        ])
        const verdicts = verdictsOf(room)
        const rejects = verdicts.filter(message => !verdictPassed(message))
        const lastVerdict = verdicts.at(-1) ?? null
        const delivered = roomCompleted(room)
        // 没有验收判定不算通过；房间完成只能说明流程走完了。
        const accepted = delivered && lastVerdict !== null && verdictPassed(lastVerdict)
        row = {
          caseId: testCase.id,
          variant: variant.label,
          engine: variant.engine,
          model: variant.model,
          memory: variant.memory,
          run,
          goal: testCase.goal,
          roomId: room.id,
          state: room.state ?? null,
          timedOut: waited.timedOut,
          delivered,
          accepted,
          pass: accepted && check.pass,
          verdict: lastVerdict === null ? null : (verdictPassed(lastVerdict) ? 'pass' : 'reject'),
          verdictReason: lastVerdict === null ? null : (judgmentOf(lastVerdict)?.reason ?? lastVerdict.text ?? null),
          rejectReasons: rejects.map(message => judgmentOf(message)?.reason ?? message.text ?? ''),
          verdicts: verdicts.length,
          rework: rejects.length,
          check: check.report,
          checkedAt: check.repo,
          elapsedMs: Date.now() - startedAt,
          usage: room.usage ?? null,
          costUsd: Number.isFinite(room.usage?.costMicroUsd) ? room.usage.costMicroUsd / 1_000_000 : null,
          warning: created.warning ?? null,
          cleanupErrors: [],
        }
      } catch (error) {
        row = {
          caseId: testCase.id,
          variant: variant.label,
          engine: variant.engine,
          model: variant.model,
          memory: variant.memory,
          run,
          goal: testCase.goal,
          roomId: room?.id ?? null,
          state: room?.state ?? null,
          timedOut: false,
          delivered: false,
          accepted: false,
          pass: false,
          verdict: null,
          verdictReason: null,
          rejectReasons: [],
          verdicts: 0,
          rework: 0,
          check: { pass: false, detail: String(error?.message ?? error), facts: {} },
          checkedAt: null,
          elapsedMs: Date.now() - startedAt,
          usage: null,
          costUsd: null,
          warning: null,
          cleanupErrors: [],
          error: String(error?.message ?? error),
        }
      } finally {
        if (room !== null) row.cleanupErrors = await cleanup(room)
        if (seedFile !== null) {
          try { if (existsSync(seedFile)) rmSync(seedFile) } catch {}
        }
        if (repo !== null) rmSync(repo, { recursive: true, force: true })
      }
      results.push(row)
      console.log([
        `${testCase.id} @ ${variant.label} #${run}:`,
        row.pass ? 'PASS' : 'FAIL',
        row.delivered ? 'delivered' : 'not-delivered',
        `verdict ${row.verdict ?? '—'}`,
        `rework ${row.rework}`,
        `${row.elapsedMs}ms`,
        row.pass ? '' : `· ${row.check?.detail ?? row.error ?? ''}`,
      ].filter(Boolean).join(' '))
    }
  }
}

const at = new Date().toISOString()
const passed = results.filter(item => item.pass).length
const reworked = results.filter(item => item.rework > 0).length
const durations = results.map(item => item.elapsedMs).sort((a, b) => a - b)
const percentile = p => durations.length === 0
  ? 0
  : durations[Math.min(durations.length - 1, Math.max(0, Math.ceil(durations.length * p) - 1))]
const costs = results.map(item => item.costUsd).filter(value => Number.isFinite(value))
const byVariant = [...new Set(results.map(item => item.variant))].map(variant => {
  const rows = results.filter(item => item.variant === variant)
  return {
    variant,
    runs: rows.length,
    passed: rows.filter(item => item.pass).length,
    rework: rows.reduce((total, item) => total + item.rework, 0),
  }
})
const comparison = baseline === null
  ? null
  : (() => {
    const compared = compareRuns(results, baseline.results)
    return compared === null
      ? null
      : {
        baselineAt: baseline.at ?? null,
        baselineCases: baseline.cases ?? baseline.results.length,
        ...compared,
      }
  })()

const summary = {
  at,
  lodge,
  runs,
  cases: results.length,
  passed,
  failed: results.length - passed,
  passRate: results.length === 0 ? 0 : passed / results.length,
  reworkedRuns: reworked,
  reworkTotal: results.reduce((total, item) => total + item.rework, 0),
  durationMs: { p50: percentile(0.5), p95: percentile(0.95), max: durations.at(-1) ?? 0 },
  costUsd: {
    total: costs.reduce((total, value) => total + value, 0),
    mean: costs.length === 0 ? null : costs.reduce((total, value) => total + value, 0) / costs.length,
    unknownRuns: results.length - costs.length,
  },
  byVariant,
  ...(comparison === null ? {} : { comparison }),
  results,
}
writeFileSync(join(outDir, 'latest.json'), `${JSON.stringify(summary, null, 2)}\n`)

const lines = [
  '# Room eval',
  '',
  `- at: ${at}`,
  `- lodge: ${lodge}`,
  `- runs: ${runs}`,
  `- passed: ${passed}/${results.length} (${Math.round(summary.passRate * 100)}%)`,
  `- rework: ${summary.reworkTotal} 次，涉及 ${reworked}/${results.length} 次运行`,
  `- 墙钟: p50 ${summary.durationMs.p50}ms · p95 ${summary.durationMs.p95}ms · max ${summary.durationMs.max}ms`,
  `- 成本: ${summary.costUsd.mean === null ? '未知' : `平均 $${summary.costUsd.mean.toFixed(4)}`} · 合计 $${summary.costUsd.total.toFixed(4)} · 未知 ${summary.costUsd.unknownRuns} 次`,
  '',
  '| case | variant | run | result | delivered | verdict | rework | ms | cost | check |',
  '|---|---|---:|---|---|---|---:|---:|---:|---|',
  ...results.map(row => [
    row.caseId,
    row.variant,
    row.run,
    row.pass ? 'PASS' : 'FAIL',
    row.delivered ? 'yes' : 'no',
    row.verdict ?? '—',
    row.rework,
    row.elapsedMs,
    Number.isFinite(row.costUsd) ? `$${row.costUsd.toFixed(4)}` : '—',
    row.pass ? 'ok' : (row.check?.detail ?? row.error ?? '—'),
  ].map(value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
  '',
  '按变体：',
  '',
  '| variant | runs | passed | rework |',
  '|---|---:|---:|---:|',
  ...byVariant.map(item => `| ${item.variant} | ${item.runs} | ${item.passed} | ${item.rework} |`),
  ...(comparison === null
    ? []
    : [
      '',
      `对照基线（${comparison.baselineAt ?? '未记时间'}）：`,
      '',
      `- 通过率 ${(comparison.delta.passRate * 100).toFixed(0)} pts · 返工 ${comparison.delta.rework} 次 · 平均墙钟 ${comparison.delta.meanMs}ms · 平均成本 ${comparison.delta.meanCostUsd === null ? '未知' : `$${comparison.delta.meanCostUsd.toFixed(4)}`}`,
      '',
      '| variant | 通过率 | 返工 | 平均墙钟 | 平均成本 |',
      '|---|---:|---:|---:|---:|',
      ...comparison.byVariant.map(item => [
        item.variant,
        `${(item.delta.passRate * 100).toFixed(0)} pts`,
        item.delta.rework,
        `${item.delta.meanMs}ms`,
        item.delta.meanCostUsd === null ? '未知' : `$${item.delta.meanCostUsd.toFixed(4)}`,
      ].join(' | ').replace(/^/, '| ').replace(/$/, ' |')),
    ]),
  '',
  '原始记录见 `latest.json`。这把尺子只看产出，不听房间里的自述。',
  '',
]
writeFileSync(join(outDir, 'latest.md'), lines.join('\n'))
console.log(`\n${passed}/${results.length} passed · rework ${summary.reworkTotal} · p50 ${summary.durationMs.p50}ms · ${join(outDir, 'latest.md')}`)
process.exitCode = passed === results.length ? 0 : 1
