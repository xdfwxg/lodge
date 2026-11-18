import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const matrix = readFileSync(resolve(root, 'docs/testing/acceptance-matrix.md'), 'utf8')
const tests = [...new Set([...matrix.matchAll(/`([^`]+\.test\.js)`/g)].map(match => match[1]))]
const missing = tests.filter(file => !existsSync(resolve(root, file)))

if (tests.length === 0) console.error('FAIL acceptance matrix references no tests')
if (missing.length > 0) console.error(`FAIL missing test files:\n${missing.join('\n')}`)
if (tests.length === 0 || missing.length > 0) process.exit(1)
console.log(`acceptance: ${tests.length} linked tests`)
