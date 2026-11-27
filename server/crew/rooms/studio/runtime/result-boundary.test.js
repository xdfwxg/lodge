import assert from 'node:assert/strict'
import test from 'node:test'
import { enforceWriteBoundary } from './result.js'

const room = (over = {}) => ({
  orchestration: 'parallel',
  members: [{ id: 'a', role: 'worker' }],
  worktrees: { a: '/tmp/work-a' },
  stages: [{ title: '实现', packages: [{ files: ['own.txt'], clauseIds: ['c1'] }], assignees: ['a'] }],
  ...over,
})

const storeOf = () => {
  const messages = []
  return { messages, appendMessage: (_roomId, message) => { messages.push(message); return message } }
}

const providerOf = ({ files, status = '', vcs = 'git' }) => {
  const calls = { reverted: null }
  return {
    calls,
    capabilities: () => ({ vcs }),
    changes: async () => ({ files, status, diff: '' }),
    revertPaths: ({ files: outside }) => {
      calls.reverted = outside
      return { reverted: outside, failed: [] }
    },
  }
}

const filePortOf = ({ proofs = [] } = {}) => ({
  read: path => {
    const hit = proofs.find(item => path.endsWith(item.name))
    if (hit === undefined) throw new Error('missing')
    return hit.text
  },
  list: () => proofs.filter(item => item.name === 'dir').map(item => item.text),
})

test('a parallel turn that writes outside its package is reverted before the candidate is committed', async () => {
  const store = storeOf()
  const provider = providerOf({ files: ['own.txt', 'someone-else.txt'], status: '?? own.txt\n?? someone-else.txt' })
  const result = await enforceWriteBoundary({
    store,
    roomId: 'room-1',
    room: room(),
    stage: room().stages[0],
    stageIndex: 0,
    memberId: 'a',
    repoPath: '/tmp/work-a',
    provider,
    filePort: filePortOf(),
  })
  assert.deepEqual(result, { files: ['someone-else.txt'], reverted: ['someone-else.txt'] })
  assert.deepEqual(provider.calls.reverted, ['someone-else.txt'])
  assert.match(store.messages.at(-1).text, /已退回/)
})

test('a new helper named by the proof is part of the delivery, not an out-of-bounds change', async () => {
  const store = storeOf()
  const provider = providerOf({ files: ['own.txt', 'tools/prove.mjs'], status: '?? own.txt\n?? tools/prove.mjs' })
  const result = await enforceWriteBoundary({
    store,
    roomId: 'room-1',
    room: room(),
    stage: room().stages[0],
    stageIndex: 0,
    memberId: 'a',
    repoPath: '/tmp/work-a',
    provider,
    filePort: filePortOf({ proofs: [{ name: 'lodge-proof.json', text: '{"entry":"node tools/prove.mjs"}' }] }),
  })
  assert.equal(result, null)
  assert.equal(store.messages.length, 0)
})

test('a workspace without git cannot revert, so the boundary stays out of the way', async () => {
  const store = storeOf()
  const provider = providerOf({ files: [], vcs: 'plain' })
  const result = await enforceWriteBoundary({
    store,
    roomId: 'room-1',
    room: room({ stageBaseManifests: {} }),
    stage: room().stages[0],
    stageIndex: 0,
    memberId: 'a',
    repoPath: '/tmp/work-a',
    provider,
    filePort: filePortOf(),
  })
  assert.equal(result, null)
})

test('a helper dir does not let one package write a file another package owns', async () => {
  // 真房（第 33 轮）：乙的包只有 lodge-proof.json，但它的证明引用了 tools/，
  // 于是把甲包里的 tools/check.mjs 也当成“辅助脚本”写掉了，两个分支合并时撞车。
  const store = storeOf()
  const parallel = {
    orchestration: 'parallel',
    members: [{ id: 'a', role: 'worker' }, { id: 'b', role: 'worker' }],
    worktrees: { a: '/tmp/work-a', b: '/tmp/work-b' },
    stages: [{
      title: '实现',
      assignees: ['a', 'b'],
      packages: [
        { files: ['hello.txt', 'tools/check.mjs'], clauseIds: ['c1'] },
        { files: ['lodge-proof.json'], clauseIds: ['c2'] },
      ],
    }],
  }
  const provider = providerOf({
    files: ['lodge-proof.json', 'tools/check.mjs'],
    status: '?? lodge-proof.json\n?? tools/check.mjs',
  })
  const result = await enforceWriteBoundary({
    store,
    roomId: 'room-1',
    room: parallel,
    stage: parallel.stages[0],
    stageIndex: 0,
    memberId: 'b',
    repoPath: '/tmp/work-b',
    provider,
    filePort: filePortOf({
      proofs: [{ name: 'lodge-proof.json', text: '{"entry":"node tools/check.mjs"}' }],
    }),
  })
  assert.deepEqual(result, { files: ['tools/check.mjs'], reverted: ['tools/check.mjs'] })
})
