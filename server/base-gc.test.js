import test from 'node:test'
import assert from 'node:assert/strict'
import { clearLodgeBaseResources, lodgeRootsOf, roomResourceRefs, selectOrphanResources } from './base-gc.js'

const env = { CREW_WORKTREE_ROOT: '/tmp/lodge/worktrees' }

const currentRoom = {
  members: [
    { name: '规划师', body: { ref: 'bot-current', roomRef: 'grp-current' } },
    { name: '执行官', body: { ref: 'bot-worker', roomRef: 'grp-worker' } },
    { name: '验收员', body: { ref: 'bot-verifier', roomRef: 'grp-verifier' } },
  ],
  chatHost: { memberRef: 'bot-host' },
  chatRoom: { id: 'grp-chat' },
}

const bots = [
  { id: 'bot-current', name: '规划师', description: '只读 · 拆阶段与派活' },
  { id: 'bot-worker', name: '执行官', description: '独立副本写 · 改代码跑测试' },
  { id: 'bot-verifier', name: '验收员', description: '只读副本 · 只写结论' },
  { id: 'bot-host', name: 'LodgeHostabc12345', description: '' },
  { id: 'bot-old', name: '执行官', description: '独立副本写 · 改代码跑测试' },
  { id: 'bot-other', name: '产品经理', description: '另一个应用的成员' },
]

const groups = [
  { id: 'grp-current', name: '当前 · 规划师', cwd: '/tmp/lodge/worktrees/current/lead', memberIds: ['bot-current'] },
  { id: 'grp-worker', name: '当前 · 执行官', cwd: '/tmp/lodge/worktrees/current/worker', memberIds: ['bot-worker'] },
  { id: 'grp-verifier', name: '当前 · 验收员', cwd: '/tmp/lodge/worktrees/current/verifier', memberIds: ['bot-verifier'] },
  { id: 'grp-chat', name: '当前 · 房间聊天', cwd: '/tmp/lodge/worktrees/current/worker', memberIds: ['bot-current', 'bot-host'] },
  { id: 'grp-old', name: '旧房 · 执行官', cwd: '/tmp/lodge/worktrees/old/worker', memberIds: ['bot-old'] },
  { id: 'grp-old-shared', name: '旧房 · 规划师', cwd: '/tmp/lodge/worktrees/old/lead', memberIds: ['bot-current'] },
  { id: 'grp-other', name: '精美前端页面开发', cwd: '', memberIds: ['bot-other'] },
]

test('current room references cover members, host and chat group', () => {
  const refs = roomResourceRefs([currentRoom])
  assert.deepEqual([...refs.bots].sort(), ['bot-current', 'bot-host', 'bot-verifier', 'bot-worker'])
  assert.deepEqual([...refs.groups].sort(), ['grp-chat', 'grp-current', 'grp-verifier', 'grp-worker'])
})

test('only old Lodge groups and bots are selected', () => {
  const result = selectOrphanResources({ rooms: [currentRoom], bots, groups, env })
  assert.deepEqual(result.groups.map(group => group.id), ['grp-old'])
  assert.deepEqual(result.bots.map(bot => bot.id).sort(), ['bot-old'])
  assert.equal(result.bots.some(bot => bot.id === 'bot-other'), false)
  assert.equal(result.groups.some(group => group.id === 'grp-other'), false)
})

test('a group that still holds a referenced bot is kept', () => {
  const result = selectOrphanResources({
    rooms: [currentRoom],
    bots,
    groups: groups.filter(group => group.id !== 'grp-current'),
    env,
  })
  assert.equal(result.groups.some(group => group.id === 'grp-old-shared'), false)
  assert.equal(result.bots.some(bot => bot.id === 'bot-current'), false)
})

test('a room worktree adds both the worktree and its workspace root', () => {
  const roots = lodgeRootsOf([{ worktrees: { lead: '/custom/root/room/lead' } }], {})
  assert.ok(roots.includes('/custom/root/room/lead'))
  assert.ok(roots.includes('/custom/root'))
})

test('an empty Lodge store selects every old Lodge resource, not other apps', () => {
  const result = selectOrphanResources({ rooms: [], bots, groups, env })
  assert.ok(result.groups.some(group => group.id === 'grp-old'))
  assert.ok(result.bots.some(bot => bot.id === 'bot-old'))
  assert.equal(result.bots.some(bot => bot.id === 'bot-other'), false)
  assert.equal(result.groups.some(group => group.id === 'grp-other'), false)
})

test('clearing a fresh Lodge store deletes its base resources and keeps other apps', async () => {
  const deleted = []
  const client = {
    bootstrap: async () => ({ bots, groups }),
    deleteGroup: async id => { deleted.push(`group:${id}`) },
    deleteBot: async id => { deleted.push(`bot:${id}`) },
  }
  const result = await clearLodgeBaseResources(client, { env })
  assert.equal(result.failures.length, 0)
  assert.ok(result.groups > 0)
  assert.ok(result.bots > 0)
  assert.equal(deleted.includes('group:grp-other'), false)
  assert.equal(deleted.includes('bot:bot-other'), false)
  assert.ok(deleted.includes('group:grp-old'))
  assert.ok(deleted.includes('bot:bot-old'))
})
