import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const index = JSON.parse(readFileSync(join(root, 'evals/regressions/index.json'), 'utf8'))
const entries = Array.isArray(index.regressions) ? index.regressions : []
const ids = new Set()
const errors = []

for (const entry of entries) {
  if (typeof entry?.id !== 'string' || entry.id.trim() === '') {
    errors.push('regression entry needs an id')
    continue
  }
  if (ids.has(entry.id)) errors.push(`duplicate regression id: ${entry.id}`)
  ids.add(entry.id)
  const test = typeof entry?.test === 'string' ? entry.test.trim() : ''
  if (test === '' || !existsSync(join(root, test))) {
    errors.push(`${entry.id}: missing test ${test || '(empty)'}`)
  }
}

if (errors.length > 0) {
  console.error(errors.join('\n'))
  process.exit(1)
}
console.log(`regressions: ${entries.length} linked tests`)
