import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  NIGHTLY_STAGES,
  main,
  nightlyExitCode,
  nightlyReportMarkdown,
  summarizeNightly,
} from './nightly-eval.mjs'

test('every stage is named and runs a real eval script', () => {
  assert.deepEqual(NIGHTLY_STAGES.map(stage => stage.id), ['rooms', 'planning', 'execution', 'verifier'])
  for (const stage of NIGHTLY_STAGES) {
    assert.match(stage.script, /^evals\/.+\.mjs$/)
    assert.ok(stage.name)
  }
})

test('one failed stage fails the night', () => {
  const stages = [
    { name: '真实房间', script: 'a', args: [], status: 0, ms: 1000 },
    { name: '验收探针', script: 'b', args: [], status: 1, ms: 2000 },
  ]
  assert.equal(summarizeNightly(stages).ok, false)
  assert.equal(nightlyExitCode({ environment: '', stages }), 1)
  assert.match(nightlyReportMarkdown({ date: '2026-11-25', stages }), /有 1 项没通过/)
})

test('a stage with no way to run is skipped, not failed', () => {
  const stages = [
    { name: '真实房间', script: 'a', args: [], status: 0, ms: 1000 },
    { name: '验收探针', script: 'b', args: [], status: 'skipped', reason: 'Lodge 没开缺陷注入', ms: 0 },
  ]
  assert.equal(summarizeNightly(stages).ok, true)
  assert.equal(nightlyExitCode({ environment: '', stages }), 0)
  assert.match(nightlyReportMarkdown({ date: '2026-11-25', stages }), /未跑（Lodge 没开缺陷注入）/)
})

test('a missing environment is a different failure from a failed stage', () => {
  assert.equal(nightlyExitCode({ environment: 'Lodge 8787：ECONNREFUSED', stages: [] }), 2)
  assert.match(
    nightlyReportMarkdown({ date: '2026-11-25', environment: '基座 8799：HTTP 502', stages: [] }),
    /环境没起来/,
  )
})

test('stages run in order, the report lands on disk, failure notifies once', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-eval-'))
  const calls = []
  const notified = []
  try {
    const result = await main({
      env: {},
      outDir: dir,
      now: () => new Date('2026-11-25T03:17:00'),
      log: () => {},
      check: async () => null,
      probeEnabled: async () => true,
      spawn: (command, args) => {
        calls.push({ command, script: args[0] })
        return { status: calls.length === 3 ? 1 : 0 }
      },
      notify: text => notified.push(text),
    })

    assert.equal(result.code, 1)
    assert.deepEqual(calls.map(call => call.script.split('/').pop()), ['run.mjs', 'run.mjs', 'run.mjs', 'run.mjs'])
    assert.match(calls[0].script, /evals\/rooms\//)
    assert.match(calls[3].script, /evals\/verifier-probe\//)
    assert.match(readFileSync(result.reportPath, 'utf8'), /2026-11-25/)
    assert.equal(notified.length, 1)
    assert.match(notified[0], /没通过/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a healthy night passes without notifying', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-eval-'))
  const notified = []
  try {
    const result = await main({
      env: {},
      outDir: dir,
      now: () => new Date('2026-11-25T03:17:00'),
      log: () => {},
      check: async () => null,
      probeEnabled: async () => true,
      spawn: () => ({ status: 0 }),
      notify: text => notified.push(text),
    })
    assert.equal(result.code, 0)
    assert.deepEqual(notified, [])
    assert.match(result.report, /全部通过/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without defect injection the verifier stage is skipped and named', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-eval-'))
  const scripts = []
  try {
    const result = await main({
      env: {},
      outDir: dir,
      now: () => new Date('2026-11-25T03:17:00'),
      log: () => {},
      check: async () => null,
      probeEnabled: async () => false,
      spawn: (command, args) => {
        scripts.push(args[0].split('/').slice(-2).join('/'))
        return { status: 0 }
      },
      notify: () => {},
    })
    assert.equal(result.code, 0)
    assert.deepEqual(scripts, ['rooms/run.mjs', 'planning-probe/run.mjs', 'execution-probe/run.mjs'])
    assert.match(result.report, /验收探针 \| 未跑（Lodge 没开缺陷注入）/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a login catch-up does nothing once today has a report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-eval-'))
  let spawned = 0
  try {
    writeFileSync(join(dir, '2026-11-25.md'), '# already ran today\n')
    const result = await main({
      env: {},
      outDir: dir,
      ifDue: true,
      now: () => new Date('2026-11-25T09:00:00'),
      log: () => {},
      check: async () => {
        throw new Error('should not check services when today already ran')
      },
      spawn: () => {
        spawned += 1
        return { status: 0 }
      },
    })
    assert.equal(result.code, 0)
    assert.equal(result.skipped, true)
    assert.equal(spawned, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing service skips the model work', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nightly-eval-'))
  let spawned = 0
  try {
    const result = await main({
      env: {},
      outDir: dir,
      now: () => new Date('2026-11-25T03:17:00'),
      log: () => {},
      check: async url => (url.includes('8787') ? 'ECONNREFUSED' : null),
      spawn: () => {
        spawned += 1
        return { status: 0 }
      },
      notify: () => {},
    })
    assert.equal(result.code, 2)
    assert.equal(spawned, 0)
    assert.match(result.report, /Lodge 8787：ECONNREFUSED/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
