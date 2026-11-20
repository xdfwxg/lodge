import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveMembers } from './rooms/create/input.js'
import { resolveRoomType } from './rooms/kinds.js'
import { roleMembers, rosterFromRoles, ROLES, membersFor, TEMPLATES, validateRoster } from './roster.js'

test('the default roster satisfies the capability contract', () => {
  assert.doesNotThrow(() => validateRoster(ROLES))
})

test('a verifier with write access fails closed', () => {
  const bad = ROLES.map(member => member.id === 'verifier'
    ? { ...member, permissions: { ...member.permissions, write: true } }
    : member)
  assert.throws(() => validateRoster(bad), /verifier/)
})

test('an executor without its own worktree fails closed', () => {
  const bad = ROLES.map(member => member.id === 'executor'
    ? { ...member, writeScope: 'repo' }
    : member)
  assert.throws(() => validateRoster(bad), /executor/)
})

test('a custom worker keeps a browser grant from the room request', () => {
  const roster = rosterFromRoles([{ role: 'worker', name: '研究员', mcp: ['chrome-devtools'] }])
  assert.deepEqual(roster[0].mcp, [{ server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }])
})

test('planner cannot hold external tools other than the read-only browser', () => {
  const bad = ROLES.map(member => member.id === 'planner'
    ? { ...member, mcp: [{ server: 'github', scopes: ['read'], approval: 'ask' }] }
    : member)
  assert.throws(() => validateRoster(bad), /lead/)
  const browser = { server: 'chrome-devtools', scopes: ['read'], approval: 'ask' }
  const allowed = ROLES.map(member => (
    member.role === 'lead' || member.role === 'verifier' ? { ...member, mcp: [browser] } : member
  ))
  assert.doesNotThrow(() => validateRoster(allowed))
})

test('mcp grants must name a server, not carry a URL or credential', () => {
  const bad = ROLES.map(member => member.id === 'executor'
    ? { ...member, mcp: [{ server: 'https://mcp.example.com?token=x', scopes: ['read'], approval: 'ask' }] }
    : member)
  assert.throws(() => validateRoster(bad), /mcp server/)
})

test('external writes require approval', () => {
  const bad = ROLES.map(member => member.id === 'executor'
    ? { ...member, mcp: [{ server: 'github', scopes: ['write'], approval: 'allow' }] }
    : member)
  assert.throws(() => validateRoster(bad), /external tools require approval/)
})

test('toolSurface must match the declared permissions', () => {
  const bad = ROLES.map(member => member.id === 'executor'
    ? { ...member, toolSurface: ['read', 'exec'] }
    : member)
  assert.throws(() => validateRoster(bad), /toolSurface/)
})

test('full approval is not allowed', () => {
  const bad = ROLES.map(member => member.id === 'executor'
    ? { ...member, approval: 'full' }
    : member)
  assert.throws(() => validateRoster(bad), /approval/)
})

test('the product default is the fixed three-member squad', () => {
  const roster = membersFor()
  assert.deepEqual(roster.map(member => member.role), ['lead', 'worker', 'verifier'])
  assert.deepEqual(roster.map(member => member.name), ['规划师', '执行官', '验收员'])
  assert.equal(TEMPLATES.solo, undefined)
  assert.doesNotThrow(() => validateRoster(roster))
})

test('default member souls carry identity, not stage SOP', () => {
  const roster = membersFor()
  const lead = roster.find(member => member.role === 'lead')
  const worker = roster.find(member => member.role === 'worker')
  const verifier = roster.find(member => member.role === 'verifier')
  assert.doesNotMatch(lead.prompt, /阶段已确认|不要重复派活/)
  assert.doesNotMatch(worker.prompt, /git commit|不要问问题|不要 @验收/)
  assert.doesNotMatch(verifier.prompt, /PASS 或 REJECT|只读复核/)
})

test('a studio room with no explicit members resolves to the fixed triad', () => {
  const members = resolveMembers({}, resolveRoomType('studio'))
  assert.equal(members.templateId, 'delivery-triad')
  assert.deepEqual(members.roster.map(member => member.role), ['lead', 'worker', 'verifier'])
  assert.deepEqual(members.roster.map(member => member.roleKind), ['planner', 'executor', 'verifier'])
})

test('a chat room does not require a worker role', () => {
  const members = resolveMembers({ members: [{ role: 'lead', name: '主持人' }] }, resolveRoomType('chat'))
  assert.equal(members.error, undefined)
  assert.equal(members.lead.name, '主持人')
  assert.deepEqual(members.workers, [])
  assert.equal(members.roster[0].roleKind, 'participant')
  assert.equal(members.roster[0].isHost, true)
})

test('a roster without a worker fails closed', () => {
  const bad = ROLES.filter(member => member.role !== 'worker')
  assert.throws(() => validateRoster(bad), /worker/)
})

test('a custom roster is composed from roles, not fixed at three', () => {
  const roster = rosterFromRoles([
    { role: 'worker', name: '前端' },
    { role: 'verifier' },
  ])
  assert.equal(roster.length, 2)
  assert.deepEqual(roster.map(member => member.role), ['worker', 'verifier'])
  assert.equal(roster[0].name, '前端')
  assert.equal(roster[1].name, '验收员')
  assert.doesNotThrow(() => validateRoster(roster))
  const { workers, verifiers, lead } = roleMembers(roster)
  assert.equal(workers[0].id, 'worker')
  assert.equal(verifiers[0].id, 'verifier')
  assert.equal(lead, workers[0])
})

test('custom roles keep their derived permissions', () => {
  const roster = rosterFromRoles([{ role: 'worker' }, { role: 'verifier', name: '复核' }])
  const worker = roster.find(member => member.role === 'worker')
  const verifier = roster.find(member => member.role === 'verifier')
  assert.equal(worker.permissions.write, true)
  assert.equal(worker.writeScope, 'own_worktree')
  assert.equal(verifier.permissions.write, false)
  assert.deepEqual(verifier.toolSurface, ['read', 'exec'])
})

test('custom members keep an explicit engine and model', () => {
  const roster = rosterFromRoles([{ role: 'worker', engine: 'pi', model: 'deepseekAnthropic/deepseek-v4-pro' }])
  assert.equal(roster[0].engine, 'pi')
  assert.equal(roster[0].model, 'deepseekAnthropic/deepseek-v4-pro')
  assert.doesNotThrow(() => validateRoster(roster))
})

test('custom names flow into the prompts', () => {
  const roster = rosterFromRoles([
    { role: 'lead', name: '总管' },
    { role: 'worker', name: '前端' },
    { role: 'verifier', name: '复核' },
  ])
  const lead = roster.find(member => member.role === 'lead')
  const worker = roster.find(member => member.role === 'worker')
  assert.match(lead.prompt, /你是总管/)
  assert.match(lead.prompt, /@前端/)
  assert.match(worker.prompt, /你是前端/)
  assert.match(worker.prompt, /@复核/)
})

test('custom rosters can declare base skill names', () => {
  const roster = rosterFromRoles([{ role: 'worker', name: '前端', skills: ['evidence-review'] }])
  assert.deepEqual(roster[0].skills, ['evidence-review'])
  assert.doesNotThrow(() => validateRoster(roster))
})

test('an unknown custom role fails closed', () => {
  assert.throws(() => rosterFromRoles([{ role: 'designer' }]), /unknown role/)
})

test('a custom member can carry a template prompt, station and engine', () => {
  const roster = rosterFromRoles([{
    role: 'worker',
    name: '小工',
    prompt: '只改一个文件，然后跑测试。',
    station: '模板执行',
    engine: 'codex-cli',
  }])
  assert.equal(roster[0].prompt, '只改一个文件，然后跑测试。')
  assert.equal(roster[0].station, '模板执行')
  assert.equal(roster[0].engine, 'codex-cli')
  assert.doesNotThrow(() => validateRoster(roster))
})

test('a custom roster can carry parallel workers', () => {
  const roster = rosterFromRoles([
    { role: 'worker', name: '前端' },
    { role: 'worker', name: '后端' },
    { role: 'verifier' },
  ])
  assert.deepEqual(roster.filter(member => member.role === 'worker').map(member => member.id), ['worker', 'worker-2'])
  assert.deepEqual(roster.filter(member => member.role === 'worker').map(member => member.name), ['前端', '后端'])
  assert.equal(roleMembers(roster).workers.length, 2)
  assert.doesNotThrow(() => validateRoster(roster))
})

test('a custom roster carries at most one verifier', () => {
  const roster = rosterFromRoles([
    { role: 'worker', name: '实现' },
    { role: 'verifier', name: '复核一' },
    { role: 'verifier', name: '复核二' },
  ])
  assert.throws(() => validateRoster(roster), /at most one verifier/)
})
