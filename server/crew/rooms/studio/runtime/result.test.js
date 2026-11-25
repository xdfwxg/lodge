import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { registerWorkspaceProvider } from '../../../workspace.js'
import { createResultMarker } from './result.js'

const providerFor = source => {
  registerWorkspaceProvider('test-result-clauses', {
    capabilities: () => ({ candidate: false, vcs: 'git' }),
    changes: async () => ({ files: ['src/export.js'], diff: 'diff', status: '' }),
    head: () => 'head',
    isolatedCopy: () => {
      const root = mkdtempSync(join(tmpdir(), 'lodge-result-copy-'))
      const path = join(root, 'repo')
      mkdirSync(path, { recursive: true })
      cpSync(source, path, { recursive: true })
      return { root, path }
    },
    removeIsolatedCopy: ({ copy }) => rmSync(copy.root, { recursive: true, force: true }),
  })
}

const setup = proof => {
  const source = mkdtempSync(join(tmpdir(), 'lodge-result-repo-'))
  writeFileSync(join(source, 'ok.mjs'), 'process.exit(0)\n')
  writeFileSync(join(source, 'lodge-proof.json'), JSON.stringify(proof))
  providerFor(source)
  const room = {
    id: 'room-1',
    name: 'Room',
    repoPath: source,
    worktrees: { executor: source },
    workspace: { provider: 'test-result-clauses' },
    orchestration: 'pipeline',
    members: [{ id: 'executor', name: '执行官', role: 'worker', roleKind: 'executor' }],
    stages: [{
      title: '实现',
      kind: 'deliverable',
      state: 'active',
      deliverable: '导出按钮能用',
      packages: [{ title: '导出', files: ['src/export.js'], clauseIds: ['export'] }],
    }],
  }
  const messages = []
  const store = {
    readRoom: () => room,
    readMessages: () => messages,
    readAssignments: () => [],
    appendMessage: (_roomId, message) => { messages.push({ ...message, seq: messages.length + 1 }); return messages.at(-1) },
    appendEvent: () => {},
  }
  const marker = createResultMarker({
    store,
    roomId: room.id,
    review: { request: async () => ({ requested: true }) },
    markProgress: () => {},
  })
  return { room, source, messages, marker }
}

test('a worker proof carries the package clauses into the delivered evidence', async () => {
  const ctx = setup({
    entry: 'node ok.mjs',
    steps: [{ clause: 'export', run: 'node ok.mjs', expect: 'exit 0' }],
  })
  try {
    await ctx.marker.markResultReady(ctx.room, 0, 't1', true, 'done', 'executor')
    const evidence = ctx.messages.find(message => message.kind === 'evidence')
    assert.equal(evidence.meta.proof.status, 'verified')
    assert.equal(evidence.meta.proof.steps.length, 1)
    assert.equal(evidence.meta.proof.steps[0].clause, 'export')
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a proof that skips the package clause is delivered as incomplete', async () => {
  const ctx = setup({
    entry: 'node ok.mjs',
    steps: [{ clause: 'other', run: 'node ok.mjs' }],
  })
  try {
    await ctx.marker.markResultReady(ctx.room, 0, 't2', true, 'done', 'executor')
    const evidence = ctx.messages.find(message => message.kind === 'evidence')
    assert.equal(evidence.meta.proof.status, 'incomplete')
    assert.deepEqual(evidence.meta.proof.missingClauses, ['export'])
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})
