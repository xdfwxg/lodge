import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { E2E_SPEC_PATTERN, NODE_TEST_PATTERNS } from './test-globs.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = readFileSync(resolve(root, 'docs/testing/acceptance-matrix.md'), 'utf8')
const tests = [...new Set([...matrix.matchAll(/`([^`]+\.(?:test|spec)\.(?:js|mjs))`/g)].map(match => match[1]))]

// 和 npm test / playwright.config.mjs 的入口保持一致：矩阵里的用例必须真的会被某个门禁跑到。
const isRunnable = file => NODE_TEST_PATTERNS.some(pattern => pattern.test(file)) || E2E_SPEC_PATTERN.test(file)

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
  if (!/\btest\s*\(/.test(source)) notRunnable.push(file)
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
const nodeTests = [...gateFiles].filter(file => !file.endsWith('.spec.mjs'))
const workRoot = mkdtempSync(join(tmpdir(), 'lodge-acceptance-'))
const run = spawnSync(process.execPath, ['--test', ...nodeTests], {
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

const specs = gateFiles.size - nodeTests.length
console.log(`acceptance: ${gateFiles.size} linked tests; ${nodeTests.length} ran here and passed, ${specs} run in test:ui`)
