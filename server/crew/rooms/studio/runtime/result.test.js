import assert from 'node:assert/strict'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { registerWorkspaceProvider } from '../../../workspace.js'
import { createResultMarker } from './result.js'

let providerCount = 0
const providerFor = (source, { vcs = 'git', manifest = null, headThrows = false, changes = null, revertPaths = null } = {}) => {
  const id = `test-result-${(providerCount += 1)}`
  registerWorkspaceProvider(id, {
    capabilities: () => ({ candidate: false, vcs }),
    changes: changes ?? (async () => ({ files: ['src/export.js'], diff: 'diff', status: '' })),
    head: headThrows ? () => { throw new Error('fatal: not a git repository') } : () => 'head',
    ...(typeof manifest === 'function' ? { manifest } : {}),
    ...(typeof revertPaths === 'function' ? { revertPaths } : {}),
    isolatedCopy: () => {
      const root = mkdtempSync(join(tmpdir(), 'lodge-result-copy-'))
      const path = join(root, 'repo')
      mkdirSync(path, { recursive: true })
      cpSync(source, path, { recursive: true })
      return { root, path }
    },
    removeIsolatedCopy: ({ copy }) => rmSync(copy.root, { recursive: true, force: true }),
  })
  return id
}

const setup = (proof, options = {}) => {
  const source = mkdtempSync(join(tmpdir(), 'lodge-result-repo-'))
  writeFileSync(join(source, 'ok.mjs'), 'process.exit(0)\n')
  writeFileSync(join(source, 'lodge-proof.json'), JSON.stringify(proof))
  const provider = providerFor(source, options)
  const room = {
    id: 'room-1',
    name: 'Room',
    repoPath: source,
    worktrees: { executor: source },
    workspace: { provider },
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
    // 和组合根一样走文件端口：证明正文从工作副本里读，不直接碰 node:fs。
    filePort: { read: path => readFileSync(path) },
  })
  return { room, source, messages, marker }
}

test('a worker proof is carried into the delivered evidence as commands', async () => {
  const ctx = setup({ entry: 'node ok.mjs', steps: ['node ok.mjs'] })
  try {
    await ctx.marker.markResultReady(ctx.room, 0, 't1', true, 'done', 'executor')
    const evidence = ctx.messages.find(message => message.kind === 'evidence')
    assert.equal(evidence.meta.proof.status, 'verified')
    assert.deepEqual(evidence.meta.proof.steps.map(item => item.run), ['node ok.mjs'])
    // 证明不再带 clause 语义：要求覆盖归验收员。
    assert.equal('missingClauses' in evidence.meta.proof, false)
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a non-git workspace reports out-of-package changes from the stage manifest', async () => {
  const ctx = setup({
    entry: 'node ok.mjs',
    steps: ['node ok.mjs'],
  }, {
    vcs: 'none',
    manifest: () => [
      { path: 'src/export.js', sha256: 'a' },
      { path: 'src/other.js', sha256: 'b' },
    ],
  })
  try {
    ctx.room.stageBaseManifests = { 0: [{ path: 'src/export.js', sha256: 'a' }] }
    await ctx.marker.markResultReady(ctx.room, 0, 't3', true, 'done', 'executor')
    const evidence = ctx.messages.find(message => message.kind === 'evidence')
    assert.deepEqual(evidence.meta.outOfBounds.files, ['src/other.js'])
    assert.deepEqual(evidence.meta.outOfBounds.reverted, [])
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a proof helper the executor just added is delivered, not reverted as out of package', async () => {
  // 真房教训：证明要重跑，证明引用的脚本不在工作包里 → 写边界退回 → 复核缺文件 → 来回三轮。
  // 规则：这一步新加的文件、且证明正文点名引用的，算这一步的交付；改已有文件仍然越界。
  const reverted = []
  const ctx = setup({
    entry: 'sh tools/prove.sh',
    steps: [{ clause: 'export', run: 'sh tools/prove.sh', expect: 'exit 0' }],
  }, {
    changes: async () => ({
      files: ['src/export.js', 'tools/prove.sh', 'src/other.js'],
      diff: 'diff',
      status: '?? tools/prove.sh\n M src/other.js',
    }),
    revertPaths: ({ files }) => {
      reverted.push(...files)
      return { reverted: files }
    },
  })
  try {
    await ctx.marker.markResultReady(ctx.room, 0, 't-proof-helper', true, 'done', 'executor')
    assert.deepEqual(reverted, ['src/other.js'], '只退回没被证明引用的已有文件改动')
    const evidence = ctx.messages.find(message => message.kind === 'evidence')
    assert.deepEqual(evidence.meta.outOfBounds.files, ['src/other.js'])
    assert.ok(!ctx.messages.some(message => /tools\/prove\.sh/.test(String(message.text ?? ''))), '证明脚本不该被当成越界')
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a red proof entry is delivered as failed, with its reason', async () => {
  const ctx = setup({ entry: 'node -e "process.exit(1)"' })
  try {
    await ctx.marker.markResultReady(ctx.room, 0, 't2', true, 'done', 'executor')
    const evidence = ctx.messages.find(message => message.kind === 'evidence')
    assert.equal(evidence.meta.proof.status, 'failed')
    assert.equal(evidence.meta.proof.exit, 1)
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})

test('a turn blocked by the read boundary is not a delivery result', async () => {
  const ctx = setup({ entry: 'node ok.mjs' })
  const reviews = []
  ctx.marker = createResultMarker({
    store: {
      readRoom: () => ctx.room,
      readMessages: () => ctx.messages,
      readAssignments: () => [],
      appendMessage: (_roomId, message) => { ctx.messages.push({ ...message, seq: ctx.messages.length + 1 }); return ctx.messages.at(-1) },
      appendEvent: () => {},
    },
    roomId: ctx.room.id,
    review: { request: async () => { reviews.push(true); return { requested: true } } },
    markProgress: () => {},
  })
  try {
    ctx.room.blocked = { stage: 0, reason: 'read-boundary' }
    await ctx.marker.markResultReady(ctx.room, 0, 't-blocked', true, '已停下', 'executor')
    assert.equal(ctx.messages.some(message => message.kind === 'evidence'), false, 'no evidence for a blocked turn')
    assert.equal(reviews.length, 0, 'no review for a blocked turn')
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})


test('a missing worktree is reported instead of taking the process down', async () => {
  const ctx = setup({
    entry: 'node ok.mjs',
    steps: [{ clause: 'export', run: 'node ok.mjs', expect: 'exit 0' }],
  }, { headThrows: true })
  try {
    await ctx.marker.markResultReady(ctx.room, 0, 't-gone', true, 'done', 'executor')
    assert.match(String(ctx.messages.at(-1)?.text ?? ''), /工作副本不见了/)
  } finally {
    rmSync(ctx.source, { recursive: true, force: true })
  }
})
