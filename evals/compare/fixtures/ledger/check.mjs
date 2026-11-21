import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const repo = resolve(process.argv[3] ?? '.')
const phase = process.argv[2]
const ledger = await import(pathToFileURL(join(repo, 'src/ledger.js')).href)
const { add, list, remove } = ledger

if (phase === 'phase1') {
  add('milk')
  add('bread')
  assert.deepEqual(list(), ['milk', 'bread'])
} else if (phase === 'phase2') {
  add('milk')
  add('bread')
  remove(0)
  assert.deepEqual(list(), ['bread'])
  add('eggs')
  assert.deepEqual(list(), ['bread', 'eggs'])
} else if (phase === 'phase3') {
  const file = join(tmpdir(), `lodge-compare-ledger-${process.pid}.json`)
  rmSync(file, { force: true })
  const env = { ...process.env, LEDGER_FILE: file }
  const run = args => {
    const result = spawnSync(process.execPath, [join(repo, 'bin/ledger.js'), ...args], {
      cwd: repo,
      env,
      encoding: 'utf8',
      timeout: 20_000,
    })
    assert.equal(result.status, 0, result.stderr || result.stdout)
    return result.stdout.trim()
  }
  run(['add', 'milk'])
  run(['add', 'bread'])
  assert.deepEqual(run(['list']).split('\n').map(item => item.trim()).filter(Boolean), ['milk', 'bread'])
  run(['remove', '0'])
  assert.deepEqual(run(['list']).split('\n').map(item => item.trim()).filter(Boolean), ['bread'])
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), ['bread'])
  rmSync(file, { force: true })
} else {
  throw new Error(`unknown phase: ${phase}`)
}

console.log(`PASS ${phase}`)
