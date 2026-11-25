import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runProof } from './proof-runner.js'

const setup = ({ proof = null, script = null } = {}) => {
  const source = mkdtempSync(join(tmpdir(), 'lodge-proof-src-'))
  if (proof !== null) writeFileSync(join(source, 'lodge-proof.json'), JSON.stringify(proof))
  if (script !== null) writeFileSync(join(source, 'verify.mjs'), script)
  const provider = {
    isolatedCopy: ({ source: from }) => {
      const root = mkdtempSync(join(tmpdir(), 'lodge-proof-copy-'))
      const path = join(root, 'repo')
      mkdirSync(path, { recursive: true })
      cpSync(from, path, { recursive: true })
      return { root, path }
    },
    removeIsolatedCopy: ({ copy }) => rmSync(copy.root, { recursive: true, force: true }),
  }
  return { source, provider }
}

test('a green proof becomes a verified run', async () => {
  const ctx = setup({
    proof: { entry: 'node verify.mjs' },
    script: 'console.log("all green")\n',
  })
  try {
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider })
    assert.equal(run.status, 'verified')
    assert.equal(run.exit, 0)
    assert.match(run.output, /all green/)
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('every contract clause needs a platform-run step, not just an entry', async () => {
  const ctx = setup({
    proof: {
      entry: 'node verify.mjs',
      steps: [{ clause: 'export', run: 'node verify.mjs', expect: 'exit 0' }],
    },
    script: 'console.log("all green")\n',
  })
  try {
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider, clauses: ['export'] })
    assert.equal(run.status, 'verified')
    assert.equal(run.steps.length, 1)
    assert.equal(run.steps[0].clause, 'export')
    assert.equal(run.steps[0].status, 'verified')
    assert.equal('missingClauses' in run, false)
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a clause without a green step leaves the proof incomplete', async () => {
  const ctx = setup({
    proof: {
      entry: 'node verify.mjs',
      steps: [{ clause: 'other', run: 'node verify.mjs' }],
    },
    script: 'console.log("all green")\n',
  })
  try {
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider, clauses: ['export'] })
    assert.equal(run.status, 'incomplete')
    assert.deepEqual(run.missingClauses, ['export'])
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a red step fails the proof even when the entry is green', async () => {
  const ctx = setup({
    proof: {
      entry: 'node verify.mjs',
      steps: [{ clause: 'export', run: 'node -e "process.exit(3)"' }],
    },
    script: 'console.log("all green")\n',
  })
  try {
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider, clauses: ['export'] })
    assert.equal(run.status, 'failed')
    assert.match(run.error, /step 没跑绿/)
    assert.equal(run.steps[0].status, 'failed')
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a failing proof keeps its exit and output', async () => {
  const ctx = setup({
    proof: { entry: 'node verify.mjs' },
    script: 'console.error("missing section")\nprocess.exit(2)\n',
  })
  try {
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider })
    assert.equal(run.status, 'failed')
    assert.equal(run.exit, 2)
    assert.match(run.output, /missing section/)
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a proof file that is a symlink is not trusted', async () => {
  const ctx = setup({
    proof: { entry: 'node verify.mjs' },
    script: 'console.log("ok")\n',
  })
  try {
    const outside = join(ctx.source, '..', 'outside-proof.json')
    writeFileSync(outside, JSON.stringify({ entry: 'node verify.mjs' }))
    rmSync(join(ctx.source, 'lodge-proof.json'), { force: true })
    symlinkSync(outside, join(ctx.source, 'lodge-proof.json'))
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider })
    assert.equal(run.status, 'missing')
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a delivery without a proof file is marked missing', async () => {
  const ctx = setup()
  try {
    const run = await runProof({ room: { repoPath: ctx.source }, provider: ctx.provider })
    assert.equal(run.status, 'missing')
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('parallel package proofs are run as one stage proof', async () => {
  const source = mkdtempSync(join(tmpdir(), 'lodge-proof-pkg-'))
  try {
    mkdirSync(join(source, 'lodge-proof'), { recursive: true })
    writeFileSync(join(source, 'verify.mjs'), 'console.log("ok")\n')
    writeFileSync(join(source, 'lodge-proof/1.json'), JSON.stringify({ entry: 'node verify.mjs' }))
    writeFileSync(join(source, 'lodge-proof/2.json'), JSON.stringify({ entry: 'node verify.mjs' }))
    const provider = {
      isolatedCopy: ({ source: from }) => {
        const root = mkdtempSync(join(tmpdir(), 'lodge-proof-copy-'))
        const path = join(root, 'repo')
        mkdirSync(path, { recursive: true })
        cpSync(from, path, { recursive: true })
        return { root, path }
      },
      removeIsolatedCopy: ({ copy }) => rmSync(copy.root, { recursive: true, force: true }),
    }
    const run = await runProof({ room: { repoPath: source }, provider })
    assert.equal(run.status, 'verified')
    assert.deepEqual(run.files, ['lodge-proof/1.json', 'lodge-proof/2.json'])
    assert.equal(run.entries.length, 2)
  } finally {
    rmSync(source, { recursive: true, force: true })
  }
})

test('a proof that also passes before the change is weak unless the step preserves behavior', async () => {
  const delivered = mkdtempSync(join(tmpdir(), 'lodge-proof-delivered-'))
  const before = mkdtempSync(join(tmpdir(), 'lodge-proof-before-'))
  const copyOf = from => {
    const root = mkdtempSync(join(tmpdir(), 'lodge-proof-copy-'))
    const path = join(root, 'repo')
    mkdirSync(path, { recursive: true })
    cpSync(from, path, { recursive: true })
    return { root, path }
  }
  const provider = {
    isolatedCopy: ({ ref }) => copyOf(ref === 'base' ? before : delivered),
    removeIsolatedCopy: ({ copy }) => rmSync(copy.root, { recursive: true, force: true }),
  }
  try {
    for (const dir of [delivered, before]) {
      writeFileSync(join(dir, 'lodge-proof.json'), JSON.stringify({ entry: 'node -e "process.exit(0)"' }))
    }
    const changed = await runProof({ room: { repoPath: delivered }, provider, ref: 'head', baseRef: 'base', behavior: 'change' })
    assert.equal(changed.status, 'verified')
    assert.equal(changed.weak, true)
    const preserved = await runProof({ room: { repoPath: delivered }, provider, ref: 'head', baseRef: 'base', behavior: 'preserve' })
    assert.equal(preserved.weak, false)
  } finally {
    rmSync(delivered, { recursive: true, force: true })
    rmSync(before, { recursive: true, force: true })
  }
})

test('a proof that fails before the change proves the change', async () => {
  const delivered = mkdtempSync(join(tmpdir(), 'lodge-proof-delivered-'))
  const before = mkdtempSync(join(tmpdir(), 'lodge-proof-before-'))
  const copyOf = from => {
    const root = mkdtempSync(join(tmpdir(), 'lodge-proof-copy-'))
    const path = join(root, 'repo')
    mkdirSync(path, { recursive: true })
    cpSync(from, path, { recursive: true })
    return { root, path }
  }
  const provider = {
    isolatedCopy: ({ ref }) => copyOf(ref === 'base' ? before : delivered),
    removeIsolatedCopy: ({ copy }) => rmSync(copy.root, { recursive: true, force: true }),
  }
  try {
    writeFileSync(join(delivered, 'lodge-proof.json'), JSON.stringify({ entry: 'node verify.mjs' }))
    writeFileSync(join(delivered, 'verify.mjs'), 'process.exit(0)\n')
    writeFileSync(join(before, 'verify.mjs'), 'process.exit(1)\n')
    const run = await runProof({ room: { repoPath: delivered }, provider, ref: 'head', baseRef: 'base', behavior: 'change' })
    assert.equal(run.status, 'verified')
    assert.equal(run.weak, false)
    assert.equal(run.entries[0].baseline, 'failed')
  } finally {
    rmSync(delivered, { recursive: true, force: true })
    rmSync(before, { recursive: true, force: true })
  }
})
