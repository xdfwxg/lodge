import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runCommand } from './acceptance.js'
import { changes } from './workspace-git.js'

const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'crew-accept-'))
  execFileSync('git', ['init', '-q'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# test\n')
  execFileSync('git', ['add', 'README.md'], { cwd: dir })
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@local', 'commit', '-q', '-m', 'init'], { cwd: dir })
  return dir
}

test('records exit code and output', async () => {
  const dir = repo()
  try {
    const result = await runCommand({ command: 'echo hi && exit 3', cwd: dir })
    assert.equal(result.exit, 3)
    assert.match(result.output, /hi/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('timeout kills the process group', async () => {
  const dir = repo()
  try {
    const result = await runCommand({ command: 'sleep 30', cwd: dir, timeoutMs: 500 })
    assert.equal(result.timedOut, true)
    assert.equal(result.exit, null)
    assert.ok(result.durationMs < 3000, `duration ${result.durationMs}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('diff includes delivery files and excludes room metadata', async () => {
  const dir = repo()
  try {
    writeFileSync(join(dir, 'hello.txt'), 'crew ok\n')
    writeFileSync(join(dir, 'README.md'), '# changed\n')
    const diff = await changes({ path: dir })
    assert.deepEqual(diff.files.sort(), ['README.md', 'hello.txt'])
    assert.match(diff.diff, /hello\.txt/)
    assert.doesNotMatch(diff.diff, /\.crew\//)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
