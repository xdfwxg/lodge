import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = readFileSync(resolve(root, 'docs/testing/acceptance-matrix.md'), 'utf8')
const tests = [...new Set([...matrix.matchAll(/`([^`]+\.(?:test|spec)\.(?:js|mjs))`/g)].map(match => match[1]))]

// 和 package.json / playwright.config.mjs 的入口保持一致：矩阵里的用例必须真的会被某个门禁跑到。
const TEST_ENTRIES = [
  /^server\/[^/]+\.test\.js$/,
  /^shared\/(?:.+\/)?[^/]+\.test\.js$/,
  /^scripts\/[^/]+\.test\.mjs$/,
  /^server\/crew\/(?:.+\/)?[^/]+\.test\.js$/,
  /^evals\/rooms\/[^/]+\.test\.js$/,
  /^ui\/src\/(?:.+\/)?[^/]+\.test\.js$/,
  /^electron\/(?:.+\/)?[^/]+\.test\.js$/,
]
const E2E_ENTRY = /^e2e\/[^/]+\.spec\.mjs$/
const isRunnable = file => TEST_ENTRIES.some(pattern => pattern.test(file)) || E2E_ENTRY.test(file)

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
console.log(`acceptance: ${gateFiles.size} linked tests, each with a test() and a gate that runs it`)
