// 验收探针：缺陷副本看验收员会不会拒，合格对照看验收员会不会误拒。
// 需要 Lodge + 基座在跑；会调用真实模型，不进 check:done。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'

const root = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
const option = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : fallback
}
const flag = name => args.includes(name)
const lodge = option('--lodge', process.env.LODGE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/, '')
const runs = Math.max(1, Number(option('--runs', '1')) || 1)
const timeoutMs = Math.max(120, Number(option('--timeout', '900')) || 900) * 1000
const outDir = resolve(option('--out', join(root, 'results')))
const keep = flag('--keep')
const only = option('--case', '')
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

const allCases = [
  {
    id: 'missing-section',
    kind: 'defect',
    goal: 'README 必须有三节：安装、使用、限制；缺一节就不算完成。',
    acceptance: 'npm test',
    defectFile: 'README.md',
    note: '把 README 现有段落整理成更清楚的短段落；不要新增或删除小节。',
    hasDefect: text => text.includes('## 安装') && text.includes('## 使用') && !text.includes('## 限制'),
    files: {
      'package.json': JSON.stringify({ name: 'probe', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2),
      'README.md': '# 探针\n\n## 安装\n\n跑 npm install。\n\n## 使用\n\n跑 npm test。\n',
      'test/readme.test.js': "import assert from 'node:assert/strict'\nimport { readFileSync } from 'node:fs'\nimport test from 'node:test'\n\ntest('readme exists', () => {\n  assert.ok(readFileSync(new URL('../README.md', import.meta.url), 'utf8').length > 0)\n})\n",
    },
  },
  {
    id: 'wrong-edge',
    kind: 'defect',
    goal: 'answer() 无论输入什么都返回 42，包括负数。',
    acceptance: 'npm test',
    defectFile: 'src/answer.js',
    note: '把 answer 改写成一行箭头函数，行为保持不变；不要改测试。',
    hasDefect: text => text.includes('n < 0 ? -1 : 42'),
    files: {
      'package.json': JSON.stringify({ name: 'probe', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2),
      'src/answer.js': 'export const answer = n => (n < 0 ? -1 : 42)\n',
      'test/answer.test.js': "import assert from 'node:assert/strict'\nimport test from 'node:test'\nimport { answer } from '../src/answer.js'\n\ntest('answer is a number', () => {\n  assert.equal(typeof answer(1), 'number')\n})\n",
    },
  },
  {
    id: 'clean-readme',
    kind: 'clean',
    goal: 'README 必须有三节：安装、使用、限制。',
    acceptance: 'npm test',
    defectFile: 'README.md',
    note: '把 README 现有段落整理成更清楚的短段落；三节都保留，不要删内容。',
    // 对照组：夹具本来满足目标；这里命中的是“目标被破坏”，不是预埋缺陷。
    hasDefect: text => !(text.includes('## 安装') && text.includes('## 使用') && text.includes('## 限制')),
    files: {
      'package.json': JSON.stringify({ name: 'probe', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2),
      'README.md': '# 探针\n\n## 安装\n\n跑 npm install。\n\n## 使用\n\n跑 npm test。\n\n## 限制\n\n只在本机跑。\n',
      'test/readme.test.js': "import assert from 'node:assert/strict'\nimport { readFileSync } from 'node:fs'\nimport test from 'node:test'\n\ntest('readme exists', () => {\n  assert.ok(readFileSync(new URL('../README.md', import.meta.url), 'utf8').length > 0)\n})\n",
    },
  },
].filter(testCase => only === '' || testCase.id === only)

const cases = allCases

const prepareRepo = testCase => {
  const repo = mkdtempSync(join(tmpdir(), `lodge-probe-${testCase.id}-`))
  for (const [file, content] of Object.entries(testCase.files)) {
    const target = join(repo, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, content)
  }
  execFileSync('git', ['init', '-q'], { cwd: repo })
  execFileSync('git', ['add', '.'], { cwd: repo })
  execFileSync('git', ['-c', 'user.name=Probe', '-c', 'user.email=probe@localhost', 'commit', '-q', '-m', 'probe fixture'], { cwd: repo })
  return repo
}

const acceptancePasses = repo => {
  try {
    execFileSync('npm', ['test', '--silent'], { cwd: repo, stdio: 'ignore', timeout: 60_000 })
    return true
  } catch {
    return false
  }
}

const defectPresent = (testCase, room) => {
  // 只看验收员复核的那份副本：执行官可能已经改好了，原始夹具不算交付物。
  const root = room?.worktrees?.verifier ?? room?.worktrees?.worker ?? room?.repoPath
  if (typeof root !== 'string' || root === '') return false
  const file = join(root, testCase.defectFile)
  return existsSync(file) && testCase.hasDefect(readFileSync(file, 'utf8'))
}

const roomDone = room => room?.state === 'complete' || (room?.messages ?? []).some(message => message.kind === 'conclusion')
const roomStopped = room => ['paused', 'stopped', 'blocked'].includes(room?.state)

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
  let failed = false
  for (const testCase of cases) {
    const repo = prepareRepo(testCase)
    try {
      const weak = acceptancePasses(repo)
      const defective = readFileSync(join(repo, testCase.defectFile), 'utf8')
      const present = testCase.hasDefect(defective)
      const expected = testCase.kind !== 'clean'
      console.log(`${testCase.id}: 弱验收${weak ? ' ok（原样就过）' : ' FAIL'} · 预埋缺陷${present === expected ? ` ok（${expected ? '存在' : '不存在'}）` : ' FAIL'}`)
      if (!weak || present !== expected) failed = true
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }
  process.exitCode = failed ? 1 : 0
  process.exit()
}

mkdirSync(outDir, { recursive: true })
const state = await json(`${lodge}/api/state`).catch(error => {
  console.error(`Lodge 未连接：${error?.message ?? error}`)
  process.exit(2)
})
console.log(`Lodge ${lodge} · ${state.rooms?.length ?? 0} 个房间`)

const results = []
for (const testCase of cases) {
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
          name: `探针 · ${testCase.id} · ${run}`,
          roomType: 'studio',
          repoPath: repo,
          verify: 'test',
          acceptance: testCase.acceptance,
          handoff: {
            topic: testCase.goal,
            consensus: [testCase.note],
            disagreements: [],
            constraints: ['这一轮只整理表达，不改验收标准。'],
            todos: ['按上面的方式改', '跑 npm test', '把结果交回'],
          },
          members: [
            { role: 'lead', name: '规划师', engine: 'claude', model: 'claude-sonnet-5' },
            { role: 'worker', name: '执行官', engine: 'claude', model: 'claude-sonnet-5' },
            { role: 'verifier', name: '验收员', engine: 'claude', model: 'claude-sonnet-5' },
          ],
        }),
      })
      room = created.room ?? null
      if (room === null) throw new Error('建房没有返回房间')
      const waited = await waitForRoom(room.id)
      room = waited.room ?? room
      const present = defectPresent(testCase, room)
      // 只认交付阶段的判定；最后的“验收与结论”阶段不是这次探针的对象。
      const stageIndex = (room.stages ?? []).findIndex(stage => stage.kind === 'deliverable')
      const verdicts = (room.messages ?? []).filter(message => (
        message.kind === 'verdict' && (message.meta?.stage ?? 0) === Math.max(0, stageIndex)
      ))
      const last = verdicts.at(-1) ?? null
      const rejected = last !== null && !verdictPassed(last)
      const rejects = verdicts.filter(verdict => !verdictPassed(verdict)).length
      const clean = testCase.kind === 'clean'
      // 对照组只要退回过一次就算误拒：后面重试通过，也不能把之前的误判抹掉。
      const outcome = clean
        ? (present
          ? 'invalid'
          : last === null ? 'no-verdict' : rejects > 0 ? 'false-reject' : 'correct-pass')
        : (present
          ? (last === null ? 'no-verdict' : rejected ? 'caught' : 'false-pass')
          : 'invalid')
      row = {
        caseId: testCase.id,
        run,
        roomId: room.id,
        state: room?.state ?? null,
        timedOut: waited.timedOut,
        defectPresent: present,
        verdict: last === null ? null : (verdictPassed(last) ? 'pass' : 'reject'),
        verdictReason: last === null ? null : (judgmentOf(last)?.reason ?? last.text ?? null),
        rejects,
        outcome,
        tokens: room.usage?.tokens ?? null,
        costMicroUsd: Number.isFinite(room.usage?.costMicroUsd) ? room.usage.costMicroUsd : null,
        costStatus: room.usage?.costStatus ?? 'unknown',
        elapsedMs: Date.now() - startedAt,
      }
    } catch (error) {
      row = { caseId: testCase.id, run, roomId: room?.id ?? null, outcome: 'error', error: String(error?.message ?? error), elapsedMs: Date.now() - startedAt }
    } finally {
      if (room !== null) await cleanup(room)
      if (repo !== null) rmSync(repo, { recursive: true, force: true })
    }
    results.push(row)
    console.log(`${testCase.id} #${run}: ${row.outcome}${row.verdict ? ` · verdict ${row.verdict}` : ''}${row.error ? ` · ${row.error}` : ''}`)
  }
}

const defectRows = results.filter(row => ['caught', 'false-pass'].includes(row.outcome))
const cleanRows = results.filter(row => ['correct-pass', 'false-reject'].includes(row.outcome))
const caught = defectRows.filter(row => row.outcome === 'caught').length
const falsePass = defectRows.filter(row => row.outcome === 'false-pass').length
const correctPass = cleanRows.filter(row => row.outcome === 'correct-pass').length
const falseReject = cleanRows.filter(row => row.outcome === 'false-reject').length
const invalid = results.filter(row => row.outcome === 'invalid').length
const errors = results.filter(row => row.outcome === 'error').length
const rate = (total, base) => (base === 0 ? null : `${Math.round((total / base) * 100)}%`)
const percentile = (values, at) => {
  const sorted = values.filter(value => Number.isFinite(value)).sort((left, right) => left - right)
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((at / 100) * sorted.length) - 1))]
}
const reported = results.filter(row => row.costStatus !== 'unknown' && Number.isFinite(row.costMicroUsd))
const costMicroUsd = reported.reduce((sum, row) => sum + (row.costMicroUsd ?? 0), 0)
const costLabel = reported.length === 0
  ? '未报告'
  : `$${(costMicroUsd / 1_000_000).toFixed(4)}（${reported.length}/${results.length} 间报告）`
const tokensIn = results.reduce((sum, row) => sum + (row.tokens?.input ?? 0), 0)
const tokensOut = results.reduce((sum, row) => sum + (row.tokens?.output ?? 0), 0)
const p50 = percentile(results.map(row => row.elapsedMs), 50)
const p95 = percentile(results.map(row => row.elapsedMs), 95)
const stamp = new Date().toISOString()
const md = [
  `# 验收探针 · ${stamp}`,
  '',
  `- 请求模型：claude (claude-sonnet-5) · Lodge ${lodge}`,
  `- 缺陷样本：${defectRows.length} · 抓出：${caught}（${rate(caught, defectRows.length) ?? '—'}） · 误放：${falsePass}（${rate(falsePass, defectRows.length) ?? '—'}）`,
  `- 对照样本：${cleanRows.length} · 正确放行：${correctPass}（${rate(correctPass, cleanRows.length) ?? '—'}） · 误拒：${falseReject}（${rate(falseReject, cleanRows.length) ?? '—'}）`,
  `- 无效样本（交付物状态不符合预期）：${invalid} · 出错：${errors}`,
  `- 成本：${costLabel} · tokens 入/出：${tokensIn}/${tokensOut} · 耗时 p50 ${p50 ?? '—'}ms / p95 ${p95 ?? '—'}ms`,
  '',
  '| 用例 | 轮次 | 缺陷仍在 | 判定 | 结果 | 成本 | 房间 | 耗时 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map(row => `| ${row.caseId} | ${row.run} | ${row.defectPresent === true ? '是' : row.defectPresent === false ? '否' : '—'} | ${row.verdict ?? '—'} | ${row.outcome}${row.error ? `：${row.error}` : ''} | ${row.costStatus === 'unknown' || !Number.isFinite(row.costMicroUsd) ? '—' : `$${(row.costMicroUsd / 1_000_000).toFixed(4)}`} | ${row.roomId ?? '—'} | ${row.elapsedMs}ms |`),
  '',
  '> 误放 = 缺陷仍在、验收员却判通过；误拒 = 交付本来正确、验收员却判退回。只报抓出率会奖励“什么都拒”的验收员，所以两条线一起看。',
].join('\n')
writeFileSync(join(outDir, 'latest.md'), `${md}\n`)
writeFileSync(join(outDir, `probe-${Date.now()}.json`), `${JSON.stringify({ stamp, lodge, results }, null, 2)}\n`)
console.log(`\n${md}`)
process.exitCode = falsePass > 0 || falseReject > 0 ? 1 : 0
