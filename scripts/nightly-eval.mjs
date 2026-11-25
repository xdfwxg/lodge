// 真实评测的夜间入口：真实房间、规划、执行、验收探针，按顺序跑并写一份日报。
// 不进 check:done：它需要 Lodge、基座和真实模型；失败时非零退出并弹通知。
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const reportDir = join(root, 'evals', 'nightly', 'results')

export const NIGHTLY_STAGES = Object.freeze([
  {
    id: 'rooms',
    name: '真实房间',
    script: 'evals/rooms/run.mjs',
    args: ['--runs', '3', '--out', 'evals/rooms/results/nightly'],
  },
  {
    id: 'planning',
    name: '规划探针',
    script: 'evals/planning-probe/run.mjs',
    args: [],
  },
  {
    id: 'execution',
    name: '执行探针',
    script: 'evals/execution-probe/run.mjs',
    args: [],
  },
  {
    id: 'verifier',
    name: '验收探针',
    script: 'evals/verifier-probe/run.mjs',
    args: ['--runs', '5', '--out', 'evals/verifier-probe/results/nightly', '--write-pool'],
  },
])

export const summarizeNightly = stages => {
  const list = Array.isArray(stages) ? stages : []
  const failed = list.filter(stage => stage.status !== 0 && stage.status !== 'skipped')
  return {
    ok: list.length > 0 && failed.length === 0,
    failed,
    skipped: list.filter(stage => stage.status === 'skipped'),
  }
}

export const nightlyExitCode = ({ environment = null, stages = [] } = {}) => {
  if (environment !== null && environment !== undefined && environment !== '') return 2
  return summarizeNightly(stages).ok ? 0 : 1
}

const duration = ms => `${Math.round(Number(ms) / 1000)}s`

export const nightlyReportMarkdown = ({ date, environment = null, stages = [] } = {}) => {
  const summary = summarizeNightly(stages)
  const lines = [
    `# Lodge 夜间真实评测 · ${date}`,
    '',
    environment === null || environment === undefined || environment === ''
      ? '环境：Lodge 和基座都连上了。'
      : `环境没起来：${environment}`,
    '',
    '| 项目 | 结果 | 耗时 | 命令 |',
    '| --- | --- | --- | --- |',
    ...(stages.length === 0
      ? ['| — | 未跑 | — | — |']
      : stages.map(stage => (
        `| ${stage.name} | ${stage.status === 0 ? '通过' : stage.status === 'skipped' ? `未跑（${stage.reason}）` : `失败（exit ${stage.status ?? 'unknown'}）`} | ${duration(stage.ms)} | \`${stage.script} ${stage.args.join(' ')}\` |`
      ))),
    '',
    environment !== null && environment !== undefined && environment !== ''
      ? '环境没起来，评测没有开始。'
      : summary.ok
        ? summary.skipped.length === 0 ? '全部通过。' : `其余通过；${summary.skipped.length} 项没跑：${summary.skipped.map(stage => stage.name).join('、')}。`
        : `有 ${summary.failed.length} 项没通过；先看日志里的第一处失败。`,
    '',
  ]
  return lines.join('\n')
}

const health = async url => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
    return response.ok ? null : `HTTP ${response.status}`
  } catch (error) {
    return String(error?.message ?? error)
  }
}

// 验收探针靠 Lodge 启动时的缺陷注入目录；没开就跳过这一项，并在日报里写明原因。
const reviewPatchEnabled = async lodgeUrl => {
  try {
    const response = await fetch(`${lodgeUrl}/api/health`, { signal: AbortSignal.timeout(3_000) })
    const body = response.ok ? await response.json() : null
    return body?.probes?.reviewPatch === true
  } catch {
    return false
  }
}

const notify = text => {
  try {
    spawnSync('osascript', ['-e', `display notification ${JSON.stringify(text)} with title "Lodge 夜间评测失败"`], { encoding: 'utf8' })
  } catch {}
}

export const main = async ({
  spawn = spawnSync,
  check = health,
  probeEnabled = reviewPatchEnabled,
  now = () => new Date(),
  env = process.env,
  notify: notifyFn = notify,
  log = line => console.log(line),
  outDir = reportDir,
  ifDue = false,
} = {}) => {
  const date = now().toLocaleDateString('sv-SE')
  const reportPath = join(outDir, `${date}.md`)
  // 登录时补跑：今天已经有日报就不再跑，避免开机和定时各跑一次。
  if (ifDue && existsSync(reportPath)) {
    log(`[nightly] 今天已有日报：${reportPath}；跳过`)
    return { code: 0, skipped: true, report: null, reportPath, stages: [], environment: null }
  }
  const lodgeUrl = env.LODGE_URL ?? 'http://127.0.0.1:8787'
  const baseUrl = env.CREW_BASE_URL ?? 'http://127.0.0.1:8799'
  const [lodgeError, baseError] = await Promise.all([check(`${lodgeUrl}/api/health`), check(`${baseUrl}/api/health`)])
  const environment = [
    lodgeError === null ? '' : `Lodge 8787：${lodgeError}`,
    baseError === null ? '' : `基座 8799：${baseError}`,
  ].filter(Boolean).join('；')
  const stages = []
  if (environment === '') {
    const reviewPatch = await probeEnabled(lodgeUrl)
    for (const stage of NIGHTLY_STAGES) {
      if (stage.id === 'verifier' && !reviewPatch) {
        stages.push({ ...stage, status: 'skipped', ms: 0, reason: 'Lodge 没开缺陷注入' })
        log(`[nightly] ${stage.name}：跳过（Lodge 没开缺陷注入）`)
        continue
      }
      const started = Date.now()
      log(`[nightly] 开始 ${stage.name}`)
      const result = spawn(process.execPath, [join(root, stage.script), ...stage.args], {
        cwd: root,
        stdio: 'inherit',
        env,
      })
      const status = Number.isInteger(result?.status) ? result.status : 1
      stages.push({ ...stage, status, ms: Date.now() - started })
      log(`[nightly] ${stage.name}：${status === 0 ? '通过' : `失败 exit ${status}`}（${duration(Date.now() - started)}）`)
    }
  }
  const report = nightlyReportMarkdown({ date, environment, stages })
  mkdirSync(outDir, { recursive: true })
  writeFileSync(reportPath, report)
  log(report)
  log(`[nightly] 报告：${reportPath}`)
  const code = nightlyExitCode({ environment, stages })
  if (code !== 0) notifyFn(`真实评测没通过；看 ${reportPath}`)
  return { code, report, reportPath, stages, environment }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await main({
    notify: process.argv.includes('--notify') ? notify : () => {},
    ifDue: process.argv.includes('--if-due'),
  })
  process.exit(result.code)
}
