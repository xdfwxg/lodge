import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { rosterFromRoles } from './seats.js'
import { createCrewPorts } from './crew-ports.js'
import { createCrewService } from './service.js'
import { createStore } from './store.js'

test('a verifier added after room creation gets a workspace, base thread and live subscription', async () => {
  const root = mkdtempSync(join(tmpdir(), 'lodge-add-seat-'))
  const previous = process.env.CREW_WORKTREE_ROOT
  process.env.CREW_WORKTREE_ROOT = join(root, 'worktrees')
  const repo = join(root, 'repo')
  const roomRepo = join(root, 'room-repo')
  try {
    mkdirSync(repo, { recursive: true })
    mkdirSync(roomRepo, { recursive: true })
    writeFileSync(join(repo, 'README.md'), '# demo\n')
    execFileSync('git', ['init', '-q'], { cwd: repo })
    execFileSync('git', ['add', 'README.md'], { cwd: repo })
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=t@local', 'commit', '-q', '-m', 'init'], { cwd: repo })

    const store = createStore({ dataDir: join(root, 'data') })
    const worker = rosterFromRoles([{ role: 'worker', name: '执行' }])[0]
    const verifier = rosterFromRoles([{ role: 'verifier', name: '复核' }])[0]
    store.writeRoom({
      id: 'room-add123',
      kind: 'room',
      name: '加席位测试',
      goal: '验证建后加验收席位',
      state: 'active',
      live: true,
      demo: false,
      imported: false,
      sourceRepo: repo,
      repoPath: roomRepo,
      workspace: { provider: 'git', capabilities: {} },
      seatSpecs: [worker, verifier],
      members: ['worker', 'verifier'],
      workers: ['worker'],
      verifiers: ['verifier'],
      seatRooms: {
        worker: { id: 'base-worker', sessionRef: 'thread-worker' },
        verifier: { id: 'base-verifier', sessionRef: 'thread-verifier' },
      },
      seatBots: { worker: 'bot-worker', verifier: 'bot-verifier' },
      seatNames: { worker: '执行', verifier: '复核' },
      engines: { worker: 'claude-1', verifier: 'claude-1' },
      seatCursors: { worker: 0, verifier: 0 },
      ports: { worker: 4100, verifier: 4110 },
      branches: { worker: 'crew/add123/worker' },
      worktrees: {},
      stages: [{ title: '实现', kind: 'deliverable', state: 'active', acceptance: 'npm test' }],
      usage: {},
      version: 1,
    })

    const calls = { attach: null }
    const engine = {
      instances: async () => [
        { id: 'claude-1', engine: 'claude', available: true },
        { id: 'codex-1', engine: 'codex', available: true },
      ],
      createSeatBot: async args => ({ id: 'bot-verifier-2', name: args.name, engine: args.engine ?? 'claude-1' }),
      createRoom: async args => ({ id: 'base-verifier-2', sessionRef: 'thread-verifier-2', name: args.name }),
      deleteSeatBot: async () => {},
      deleteRoom: async () => {},
    }
    const live = {
      attachSeat: async (roomId, seat) => {
        calls.attach = [roomId, seat]
      },
    }
    const service = createCrewService({
      store,
      engine,
      live,
      emit: () => {},
      dispatchPayload: () => null,
      seats: [],
      dataDir: join(root, 'data'),
      ports: createCrewPorts(),
    })
    const result = await service.roomRequest('room-add123', 'seats', {
      method: 'POST',
      readBody: async () => ({ role: 'verifier', name: '复核二' }),
    })
    assert.equal(result.ok, true)
    const room = store.readRoom('room-add123')
    assert.deepEqual(room.verifiers, ['verifier', 'verifier-2'])
    assert.equal(room.seatSpecs.length, 3)
    assert.equal(room.seatSpecs[2].id, 'verifier-2')
    assert.equal(room.engines['verifier-2'], 'codex-1')
    assert.equal(room.seatRooms['verifier-2'].id, 'base-verifier-2')
    assert.equal(room.seatBots['verifier-2'], 'bot-verifier-2')
    assert.equal(typeof room.worktrees['verifier-2'], 'string')
    assert.equal(room.ports['verifier-2'] > 4110, true)
    assert.deepEqual(calls.attach, ['room-add123', 'verifier-2'])
    assert.equal(store.readMessages('room-add123').at(-1).text.includes('已加入验收席位'), true)

    store.updateRoom('room-add123', current => {
      current.state = 'paused'
      return { events: [] }
    })
    const changed = await service.changeSeatRole('room-add123', 'verifier-2', 'worker')
    assert.equal(changed.ok, true)
    const afterRole = store.readRoom('room-add123')
    assert.deepEqual(afterRole.verifiers, ['verifier'])
    assert.deepEqual(afterRole.workers, ['worker', 'worker-2'])
    assert.equal(afterRole.seatSpecs.length, 3)
    assert.equal(typeof afterRole.worktrees['worker-2'], 'string')

    const removed = await service.removeSeat('room-add123', 'worker-2')
    assert.equal(removed.ok, true)
    const after = store.readRoom('room-add123')
    assert.deepEqual(after.workers, ['worker'])
    assert.equal(after.seatSpecs.length, 2)
    assert.equal(after.worktrees['worker-2'], undefined)
    assert.equal(store.readMessages('room-add123').at(-1).text.includes('已移除席位'), true)
  } finally {
    if (previous === undefined) delete process.env.CREW_WORKTREE_ROOT
    else process.env.CREW_WORKTREE_ROOT = previous
    rmSync(root, { recursive: true, force: true })
  }
})
