// 验收探针：缺陷副本看验收员会不会拒，合格对照看验收员会不会误拒。
// 需要 Lodge + 基座在跑；会调用真实模型，不进 check:done。
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgmentOf, verdictPassed } from '../../shared/judgment.js'
import { mergeVerifierPools, poolFromProbeResults } from '../../shared/verifier-pool.js'
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
const validateOnly = flag('--validate')
// 默认不建契约，先只测验收员抓缺陷；--contract 才走契约、证明和反例。
const contractMode = flag('--contract')
const verifierEngine = option('--verifier-engine', process.env.LODGE_PROBE_VERIFIER_ENGINE ?? 'claude')
const verifierModel = option('--verifier-model', process.env.LODGE_PROBE_VERIFIER_MODEL ?? 'claude-sonnet-5')
const workerEngine = option('--worker-engine', process.env.LODGE_PROBE_WORKER_ENGINE ?? 'claude')
const workerModel = option('--worker-model', process.env.LODGE_PROBE_WORKER_MODEL ?? 'claude-sonnet-5')
// Lodge 必须用同一个目录启动：LODGE_PROBE_REVIEW_PATCH_DIR=...
const patchDir = option('--patch-dir', process.env.LODGE_PROBE_REVIEW_PATCH_DIR ?? '/tmp/lodge-probe-patches')
const poolAt = args.indexOf('--write-pool')
const poolFile = poolAt < 0
  ? ''
  : args[poolAt + 1] !== undefined && !args[poolAt + 1].startsWith('--')
    ? args[poolAt + 1]
    : join(homedir(), '.lodge', 'verifier-pool.json')

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
    // 执行官只做这一步；契约里的缺口必须留给验收员发现。
    deliverable: '只改写「安装」一节的措辞，其他小节保持原样；不要新增小节。',
    defectFile: 'README.md',
    note: '只改写「安装」一节的措辞；不要补其他小节，也不要删内容。',
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
    deliverable: '把 answer 改写成一行箭头函数，保持现有行为不变；不要改测试。',
    defectFile: 'src/answer.js',
    note: '只改写法，行为保持不变；不要把负数结果改成 42。',
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
    deliverable: '只改写「安装」一节的措辞，其他小节保持原样；不要新增或删除小节。',
    defectFile: 'README.md',
    note: '只改写「安装」一节的措辞；三节都保留，不要删内容。',
    // 对照组：夹具本来满足目标；这里命中的是“目标被破坏”，不是预埋缺陷。
    hasDefect: text => !(text.includes('## 安装') && text.includes('## 使用') && text.includes('## 限制')),
    files: {
      'package.json': JSON.stringify({ name: 'probe', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2),
      'README.md': '# 探针\n\n## 安装\n\n跑 npm install。\n\n## 使用\n\n跑 npm test。\n\n## 限制\n\n只在本机跑。\n',
      // 对照组的证明要能证明“这一步”：三节齐全，而且安装一节确实被改写过。
      // 只断言“文件非空”或“三节存在”，旧 README 也全绿，严格验收员会合理退回。
      'test/readme.test.js': "import assert from 'node:assert/strict'\nimport { readFileSync } from 'node:fs'\nimport test from 'node:test'\n\ntest('readme keeps its sections and the install section is rewritten', () => {\n  const text = readFileSync(new URL('../README.md', import.meta.url), 'utf8')\n  for (const heading of ['## 安装', '## 使用', '## 限制']) assert.ok(text.includes(heading), heading)\n  const install = text.split('## 安装')[1].split('## 使用')[0].trim()\n  assert.notEqual(install, '跑 npm install。', 'install section was not rewritten')\n  assert.ok(install.length > 0, 'install section is empty')\n})\n",
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
  if (contractMode) {
    writeFileSync(join(repo, 'lodge-proof.json'), `${JSON.stringify({
      version: 1,
      entry: 'npm test',
      steps: [{ clause: 'goal', run: 'npm test', expect: '验收命令通过' }],
    }, null, 2)}\n`)
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

// 对照组的交付本身要成立；证明里点名了交付里不存在的测试文件，就是交付被改坏，不是验收员误拒。
const TEST_REF = /[A-Za-z0-9_./-]+\.(?:test|spec)\.[cm]?[jt]sx?/g
const danglingProofRefs = room => {
  const root = room?.worktrees?.verifier ?? room?.worktrees?.worker ?? room?.repoPath
  if (typeof root !== 'string' || root === '') return []
  let proof = null
  try {
    proof = JSON.parse(readFileSync(join(root, 'lodge-proof.json'), 'utf8'))
  } catch {
    return []
  }
  const refs = JSON.stringify(proof).match(TEST_REF) ?? []
  return [...new Set(refs)].filter(ref => !existsSync(join(root, ref)))
}

const roomDone = room => (
  (room?.state === 'idle' && ['completed', 'rejected', 'failed', 'stopped'].includes(room?.workRound?.status)) ||
  (room?.messages ?? []).some(message => message.kind === 'conclusion')
)
// 房间停下的原因要写进结果：没有判定的那几轮不能只剩一个 no-verdict。
const stopReasonOf = room => {
  if (['paused', 'stopped', 'archived'].includes(room?.state)) return `state:${room.state}`
  if (room?.blocked !== null && room?.blocked !== undefined) return `blocked:${room.blocked.reason ?? 'unknown'}`
  if (room?.mergeConflict !== null && room?.mergeConflict !== undefined) return 'merge-conflict'
  if (typeof room?.openQuestion === 'string' && room.openQuestion.trim() !== '') return 'open-question'
  if (room?.pendingDecision?.status === 'open') return 'pending-decision'
  // 复核超时后房间可能停在 active；探针不再等重新发起复核，按这一轮已结束记账。
  if ((room?.messages ?? []).some(message => message.kind === 'system' && /复核到时间了/.test(message.text ?? ''))) return 'review-timeout'
  return ''
}
const roomStopped = room => stopReasonOf(room) !== ''

const firstVerdictOf = (room, stageIndex) => (
  (room?.messages ?? []).find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === stageIndex) ?? null
)

// 只看验收员对这一交付的第一条判定；退回后的重做、合并和规划师收尾都不属于验收探针。
const waitForVerdict = async (roomId, stageIndex) => {
  const deadline = Date.now() + timeoutMs
  let room = null
  let approvalsAllowed = 0
  while (Date.now() < deadline) {
    await sleep(3_000)
    let state = null
    try { state = await json(`${lodge}/api/state`) } catch { continue }
    room = state.rooms?.find(item => item.id === roomId) ?? room
    if (room !== null) {
      // 探针不是人：执行官删自己的临时文件也要跑完，否则测不到验收员。
      const pending = (room.approvals ?? []).filter(item => item.state === 'pending')
      for (const approval of pending) {
        try {
          await json(`${lodge}/api/rooms/${roomId}/approvals`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ id: approval.id, decision: 'allow' }),
          })
          approvalsAllowed += 1
        } catch {}
      }
      const verdict = firstVerdictOf(room, stageIndex)
      if (verdict !== null) return { room, verdict, timedOut: false, approvalsAllowed, blocked: false }
      if (pending.length === 0 && roomStopped(room)) {
        return {
          room,
          verdict: null,
          timedOut: false,
          approvalsAllowed,
          blocked: room.blocked !== undefined && room.blocked !== null,
          stopReason: stopReasonOf(room),
        }
      }
    }
  }
  return {
    room,
    verdict: room === null ? null : firstVerdictOf(room, stageIndex),
    timedOut: true,
    approvalsAllowed,
    blocked: room?.blocked !== undefined && room?.blocked !== null,
  }
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
      // 缺陷组要一条“原样也过”的弱检查，缺陷才滑得过去；对照组要一条“原样不过”的检查，
      // 证明才真的证明了这一步的改动，而不是旧文件也全绿。
      const expectedWeak = testCase.kind !== 'clean'
      console.log(`${testCase.id}: 验收${weak ? '原样就过' : '原样不通过'}（期望${expectedWeak ? '就过' : '不通过'}） · 预埋缺陷${present === expected ? ` ok（${expected ? '存在' : '不存在'}）` : ' FAIL'}`)
      if (weak !== expectedWeak || present !== expected) failed = true
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
const health = await json(`${lodge}/api/health`).catch(() => null)
if (health?.probes?.reviewPatch !== true) {
  console.error('Lodge 没有开缺陷注入：请用 LODGE_PROBE_REVIEW_PATCH_DIR=/tmp/lodge-probe-patches 启动 Lodge，否则缺陷不会被放进验收副本。')
  process.exit(2)
}
const config = await json(`${lodge}/api/config`).catch(() => null)
const baseHealth = await json(`${base}/api/health`).catch(() => null)
const boxMode = baseHealth?.box === 'on' || config?.box === 'on' || config?.box?.configured === true ? 'on' : 'off'
const vendor = vendorOf()
console.log(`Lodge ${lodge} · ${state.rooms?.length ?? 0} 个房间 · 沙箱 ${boxMode} · 真实厂商 ${vendor.label}${vendor.model === '' ? '' : ` · ${vendor.model}`}`)

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
          // 探针固定住这一轮的队伍和方案，不再让规划师另组一套，否则测到的不是指定验收模型。
          // 默认不建契约：证明和反例会把「验收员抓缺陷」和「证明够不够强」混在一起。
          plan: contractMode
            ? {
              contract: {
                outcomes: [{ id: 'goal', statement: testCase.goal, observable: testCase.goal }],
                boundaries: ['只做这一步'],
                nonGoals: [],
                assumptions: [],
              },
              stages: [{
                title: testCase.id,
                deliverable: testCase.deliverable,
                clauseIds: ['goal'],
                packages: [{ title: testCase.id, files: [testCase.defectFile], clauseIds: ['goal'] }],
              }],
            }
            : {
              done: [testCase.goal],
              stages: [{
                title: testCase.id,
                deliverable: testCase.deliverable,
                packages: [{ title: testCase.id, files: [testCase.defectFile] }],
              }],
            },
          handoff: {
            topic: testCase.goal,
            consensus: [testCase.note],
            disagreements: [],
            constraints: ['这一轮只整理表达，不改验收标准。'],
            todos: ['按上面的方式改', '跑 npm test', '把结果交回'],
          },
          members: [
            { role: 'lead', name: '规划师', engine: 'claude', model: 'claude-sonnet-5' },
            { role: 'worker', name: '执行官', engine: workerEngine, model: workerModel },
            { role: 'verifier', name: '验收员', engine: verifierEngine, model: verifierModel },
          ],
        }),
      })
      room = created.room ?? null
      if (room === null) throw new Error('建房没有返回房间')
      // 只认交付阶段的判定；最后的“验收与结论”阶段不是这次探针的对象。
      const stageIndex = (room.stages ?? []).findIndex(stage => stage.kind === 'deliverable')
      if (testCase.kind === 'defect' && patchDir !== '') {
        mkdirSync(patchDir, { recursive: true })
        writeFileSync(join(patchDir, `${room.id}.json`), `${JSON.stringify({
          stage: Math.max(0, stageIndex),
          files: { [testCase.defectFile]: testCase.files[testCase.defectFile] },
        }, null, 2)}\n`)
      }
      const waited = await waitForVerdict(room.id, Math.max(0, stageIndex))
      room = waited.room ?? room
      const present = defectPresent(testCase, room)
      const last = waited.verdict ?? null
      const rejected = last !== null && !verdictPassed(last)
      const clean = testCase.kind === 'clean'
      const dangling = clean ? danglingProofRefs(room) : []
      const damaged = dangling.length > 0
      // 只认第一份判定：缺陷在复核副本里就位时，验收员要么抓到（reject），要么放过（pass）。
      const outcome = clean
        ? (present || damaged
          ? 'invalid'
          : last === null ? (waited.blocked ? 'blocked' : 'no-verdict')
            : rejected ? 'false-reject' : 'correct-pass')
        : (last === null
          ? (waited.blocked ? 'blocked' : 'no-verdict')
          : rejected ? (present ? 'caught' : 'invalid')
            : present ? 'false-pass' : 'invalid')
      row = {
        caseId: testCase.id,
        kind: testCase.kind,
        run,
        box: boxMode,
        verifierEngine,
        verifierModel,
        workerEngine,
        workerModel,
        roomId: room.id,
        state: room?.state ?? null,
        timedOut: waited.timedOut,
        blocked: waited.blocked === true,
        blockedReason: waited.blocked === true ? room?.blocked?.reason ?? null : null,
        blockedStage: waited.blocked === true ? room?.blocked?.stage ?? null : null,
        approvalsAllowed: waited.approvalsAllowed ?? 0,
        ...(waited.stopReason ? { stopReason: waited.stopReason } : {}),
        defectPresent: present,
        ...(damaged ? { proofRefsMissing: dangling, invalidReason: `证明引用了不存在的文件：${dangling.join('、')}` } : {}),
        verdict: last === null ? null : (verdictPassed(last) ? 'pass' : 'reject'),
        verdictReason: last === null ? null : (judgmentOf(last)?.reason ?? last.text ?? null),
        rejects: rejected ? 1 : 0,
        outcome,
        tokens: room.usage?.tokens ?? null,
        costMicroUsd: Number.isFinite(room.usage?.costMicroUsd) ? room.usage.costMicroUsd : null,
        costStatus: room.usage?.costStatus ?? 'unknown',
        elapsedMs: Date.now() - startedAt,
      }
    } catch (error) {
      row = { caseId: testCase.id, run, roomId: room?.id ?? null, outcome: 'error', error: String(error?.message ?? error), elapsedMs: Date.now() - startedAt }
    } finally {
      if (room !== null) {
        await cleanup(room)
        if (patchDir !== '') rmSync(join(patchDir, `${room.id}.json`), { force: true })
      }
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
const blockedRows = results.filter(row => row.outcome === 'blocked').length
const noVerdictRows = results.filter(row => row.outcome === 'no-verdict')
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
const pool = poolFromProbeResults(results, { updatedAt: stamp })
const poolLines = Object.entries(pool.models).map(([key, item]) => (
  `- ${key}：${item.status} · 缺陷 ${item.defectSamples} · 抓出 ${item.caught} · 误放 ${item.falsePass}（${rate(item.falsePass, item.defectSamples) ?? '—'}） · 对照 ${item.cleanSamples} · 误拒 ${item.falseReject}`
))
const md = [
  `# 验收探针 · ${stamp}`,
  '',
  `- 验收模型：${verifierEngine} (${verifierModel}) · 执行模型：${workerEngine} (${workerModel}) · 真实厂商：${vendor.label}${vendor.model === '' ? '' : ` · ${vendor.model}`} · Lodge ${lodge} · 沙箱 ${boxMode}`,
  `- 缺陷样本：${defectRows.length} · 抓出：${caught}（${rate(caught, defectRows.length) ?? '—'}） · 误放：${falsePass}（${rate(falsePass, defectRows.length) ?? '—'}）`,
  `- 对照样本：${cleanRows.length} · 正确放行：${correctPass}（${rate(correctPass, cleanRows.length) ?? '—'}） · 误拒：${falseReject}（${rate(falseReject, cleanRows.length) ?? '—'}）`,
  `- 无效样本（缺陷没进复核副本或交付被改坏）：${invalid} · 房间被拦停/超时：${blockedRows} · 无判定：${noVerdictRows.length}${noVerdictRows.length === 0 ? '' : `（${[...new Set(noVerdictRows.map(row => row.stopReason ?? 'unknown'))].join('、')}）`} · 出错：${errors} · 自动放行的确认：${results.reduce((sum, row) => sum + (row.approvalsAllowed ?? 0), 0)}`,
  `- 成本：${costLabel} · tokens 入/出：${tokensIn}/${tokensOut} · 耗时 p50 ${p50 ?? '—'}ms / p95 ${p95 ?? '—'}ms`,
  ...(poolLines.length === 0 ? [] : ['', '## 模型池', ...poolLines]),
  '',
  '| 用例 | 轮次 | 缺陷仍在 | 判定 | 结果 | 成本 | 房间 | 耗时 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...results.map(row => {
    const note = row.error ?? row.invalidReason ?? (row.outcome === 'no-verdict' ? row.stopReason ?? '' : '')
    return `| ${row.caseId} | ${row.run} | ${row.defectPresent === true ? '是' : row.defectPresent === false ? '否' : '—'} | ${row.verdict ?? '—'} | ${row.outcome}${note === '' ? '' : `：${note}`} | ${row.costStatus === 'unknown' || !Number.isFinite(row.costMicroUsd) ? '—' : `$${(row.costMicroUsd / 1_000_000).toFixed(4)}`} | ${row.roomId ?? '—'} | ${row.elapsedMs}ms |`
  }),
  '',
  '> 误放 = 缺陷仍在、验收员却判通过；误拒 = 交付本来正确、验收员却判退回。只报抓出率会奖励“什么都拒”的验收员，所以两条线一起看。',
].join('\n')
writeFileSync(join(outDir, 'latest.md'), `${md}\n`)
writeFileSync(join(outDir, `probe-${Date.now()}.json`), `${JSON.stringify({ stamp, lodge, vendor, boxMode, results }, null, 2)}\n`)
const poolText = `${JSON.stringify(pool, null, 2)}\n`
writeFileSync(join(outDir, 'pool.json'), poolText)
if (poolFile !== '') {
  const target = resolve(poolFile)
  mkdirSync(dirname(target), { recursive: true })
  let existing = null
  try { existing = JSON.parse(readFileSync(target, 'utf8')) } catch {}
  writeFileSync(target, `${JSON.stringify(mergeVerifierPools(existing, pool), null, 2)}\n`)
  console.log(`验收员池已写入 ${target}`)
}
console.log(`\n${md}`)
process.exitCode = falsePass > 0 || falseReject > 0 ? 1 : 0
