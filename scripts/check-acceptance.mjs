import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_SPEC_PATTERN, NODE_TEST_PATTERNS } from './test-globs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = readFileSync(resolve(root, 'docs/testing/acceptance-matrix.md'), 'utf8')
const tests = [...new Set([...matrix.matchAll(/`([^`]+\.(?:test|spec)\.(?:js|mjs))`/g)].map(match => match[1]))]

// 和 npm test / playwright.config.mjs / base:rs:test 的入口保持一致：矩阵里的用例必须真的会被某个门禁跑到。
// 基座那套是独立脚本（自带 assert、需要先构建二进制），不算 node:test 文件，由 base:rs:test 跑。
const scripts = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).scripts ?? {}
// 基座那套分在多个 npm 脚本里（构建、契约、成绩单、浸泡、对照）；矩阵引用哪个都算被某个门禁跑到。
const baseScript = Object.entries(scripts)
  .filter(([name]) => name.startsWith('base:rs:'))
  .map(([, command]) => command)
  .join(' && ')
const isBaseTest = file => /^base-rs\/[^/]+\.test\.mjs$/.test(file) && baseScript.includes(file)
const isRunnable = file => NODE_TEST_PATTERNS.some(pattern => pattern.test(file)) || E2E_SPEC_PATTERN.test(file) || isBaseTest(file)

const missing = []
const empty = []
const notRunnable = []
const notLinkedToGate = []
const gateFiles = new Set()

for (const file of tests) {
  const path = resolve(root, file)
  if (!existsSync(path)) {
    missing.push(file)
    continue
  }
  const source = readFileSync(path, 'utf8')
  if (isBaseTest(file) ? !/\bassert\./.test(source) : !/\btest\s*\(/.test(source)) notRunnable.push(file)
  if (source.trim() === '') empty.push(file)
  if (!isRunnable(file)) notLinkedToGate.push(file)
  else gateFiles.add(file)
}

if (tests.length === 0) console.error('FAIL acceptance matrix references no tests')
if (missing.length > 0) console.error(`FAIL missing test files:\n${missing.join('\n')}`)
if (empty.length > 0) console.error(`FAIL empty test files:\n${empty.join('\n')}`)
if (notRunnable.length > 0) console.error(`FAIL test files with no test():\n${notRunnable.join('\n')}`)
if (notLinkedToGate.length > 0) console.error(`FAIL files not picked up by npm test or Playwright:\n${notLinkedToGate.join('\n')}`)
if (tests.length === 0 || missing.length > 0 || empty.length > 0 || notRunnable.length > 0 || notLinkedToGate.length > 0) {
  process.exit(1)
}

// Node 单测在这里真跑一遍；Playwright spec 由 test:ui 跑。
const nodeTests = [...gateFiles].filter(file => !file.endsWith('.spec.mjs') && !file.startsWith('base-rs/'))
const workRoot = mkdtempSync(join(tmpdir(), 'lodge-acceptance-'))
// 和 npm test 同一套测试预载：命令执行端口指向本地 exec，而不是生产里的基座。
const preload = new URL('./test-runner.mjs', import.meta.url).href
const run = spawnSync(process.execPath, ['--import', preload, '--test', ...nodeTests], {
  cwd: root,
  encoding: 'utf8',
  timeout: 300_000,
  env: {
    ...process.env,
    CREW_WORKTREE_ROOT: join(workRoot, 'worktrees'),
    CREW_WORKSPACE_ROOT: join(workRoot, 'workspaces'),
  },
})
rmSync(workRoot, { recursive: true, force: true })

if (run.status !== 0) {
  const tail = `${run.stdout ?? ''}\n${run.stderr ?? ''}`.trim().split('\n').slice(-60).join('\n')
  console.error(`FAIL linked behaviour tests:\n${tail}`)
  process.exit(1)
}

const baseTests = [...gateFiles].filter(file => isBaseTest(file))
const specs = gateFiles.size - nodeTests.length - baseTests.length
console.log(`acceptance: ${gateFiles.size} linked tests; ${nodeTests.length} ran here and passed, ${specs} run in test:ui, ${baseTests.length} in base:rs:test`)
