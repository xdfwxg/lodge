import assert from 'node:assert/strict'
import test from 'node:test'
import { roleSeats, rosterFromRoles, SEATS, seatsFor, validateSeats } from './seats.js'

test('the default roster satisfies the capability contract', () => {
  assert.doesNotThrow(() => validateSeats(SEATS))
})

test('a verifier with write access fails closed', () => {
  const bad = SEATS.map(seat => seat.id === 'verifier'
    ? { ...seat, permissions: { ...seat.permissions, write: true } }
    : seat)
  assert.throws(() => validateSeats(bad), /verifier/)
})

test('an executor without its own worktree fails closed', () => {
  const bad = SEATS.map(seat => seat.id === 'executor'
    ? { ...seat, writeScope: 'repo' }
    : seat)
  assert.throws(() => validateSeats(bad), /executor/)
})

test('planner cannot hold external tools', () => {
  const bad = SEATS.map(seat => seat.id === 'planner'
    ? { ...seat, mcp: [{ server: 'github', scopes: ['read'], approval: 'ask' }] }
    : seat)
  assert.throws(() => validateSeats(bad), /lead/)
})

test('mcp grants must name a server, not carry a URL or credential', () => {
  const bad = SEATS.map(seat => seat.id === 'executor'
    ? { ...seat, mcp: [{ server: 'https://mcp.example.com?token=x', scopes: ['read'], approval: 'ask' }] }
    : seat)
  assert.throws(() => validateSeats(bad), /mcp server/)
})

test('external writes require approval', () => {
  const bad = SEATS.map(seat => seat.id === 'executor'
    ? { ...seat, mcp: [{ server: 'github', scopes: ['write'], approval: 'allow' }] }
    : seat)
  assert.throws(() => validateSeats(bad), /external tools require approval/)
})

test('toolSurface must match the declared permissions', () => {
  const bad = SEATS.map(seat => seat.id === 'executor'
    ? { ...seat, toolSurface: ['read', 'exec'] }
    : seat)
  assert.throws(() => validateSeats(bad), /toolSurface/)
})

test('skills are ids, not inline content', () => {
  const bad = SEATS.map(seat => seat.id === 'planner'
    ? { ...seat, skills: ['./skills/goal-grill.md'] }
    : seat)
  assert.throws(() => validateSeats(bad), /skills/)
})

test('full approval is not allowed', () => {
  const bad = SEATS.map(seat => seat.id === 'executor'
    ? { ...seat, approval: 'full' }
    : seat)
  assert.throws(() => validateSeats(bad), /approval/)
})

test('the solo template is a one-seat roster', () => {
  const solo = seatsFor('solo')
  assert.equal(solo.length, 1)
  assert.equal(roleSeats(solo).workers.length, 1)
  assert.equal(roleSeats(solo).verifiers.length, 0)
  assert.doesNotThrow(() => validateSeats(solo))
})

test('a roster without a worker fails closed', () => {
  const bad = SEATS.filter(seat => seat.role !== 'worker')
  assert.throws(() => validateSeats(bad), /worker/)
})

test('a custom roster is composed from roles, not fixed at three', () => {
  const roster = rosterFromRoles([
    { role: 'worker', name: '前端' },
    { role: 'verifier' },
  ])
  assert.equal(roster.length, 2)
  assert.deepEqual(roster.map(seat => seat.role), ['worker', 'verifier'])
  assert.equal(roster[0].name, '前端')
  assert.equal(roster[1].name, '验收')
  assert.doesNotThrow(() => validateSeats(roster))
  const { workers, verifiers, lead } = roleSeats(roster)
  assert.equal(workers[0].id, 'worker')
  assert.equal(verifiers[0].id, 'verifier')
  assert.equal(lead, workers[0])
})

test('custom roles keep their derived permissions', () => {
  const roster = rosterFromRoles([{ role: 'worker' }, { role: 'verifier', name: '复核' }])
  const worker = roster.find(seat => seat.role === 'worker')
  const verifier = roster.find(seat => seat.role === 'verifier')
  assert.equal(worker.permissions.write, true)
  assert.equal(worker.writeScope, 'own_worktree')
  assert.equal(verifier.permissions.write, false)
  assert.deepEqual(verifier.toolSurface, ['read', 'exec'])
})

test('custom names flow into the prompts', () => {
  const roster = rosterFromRoles([
    { role: 'lead', name: '总管' },
    { role: 'worker', name: '前端' },
    { role: 'verifier', name: '复核' },
  ])
  const lead = roster.find(seat => seat.role === 'lead')
  const worker = roster.find(seat => seat.role === 'worker')
  assert.match(lead.prompt, /你是总管/)
  assert.match(lead.prompt, /@前端/)
  assert.match(worker.prompt, /你是前端/)
  assert.match(worker.prompt, /@复核/)
})

test('an unknown custom role fails closed', () => {
  assert.throws(() => rosterFromRoles([{ role: 'designer' }]), /unknown role/)
})

test('a custom seat can carry a template prompt, station and engine', () => {
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
  assert.doesNotThrow(() => validateSeats(roster))
})

test('a custom roster can carry parallel workers', () => {
  const roster = rosterFromRoles([
    { role: 'worker', name: '前端' },
    { role: 'worker', name: '后端' },
    { role: 'verifier' },
  ])
  assert.deepEqual(roster.filter(seat => seat.role === 'worker').map(seat => seat.id), ['worker', 'worker-2'])
  assert.deepEqual(roster.filter(seat => seat.role === 'worker').map(seat => seat.name), ['前端', '后端'])
  assert.equal(roleSeats(roster).workers.length, 2)
  assert.doesNotThrow(() => validateSeats(roster))
})
