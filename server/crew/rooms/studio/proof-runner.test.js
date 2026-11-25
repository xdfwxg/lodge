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
