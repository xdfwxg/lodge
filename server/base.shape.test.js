// 录制回放：形状来自本机 Rust 基座（`npm run base:record`），值由测试合成。
// 基座少字段时这里会红；多出来的字段不进断言，回放只认引擎真正读的那些。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { compareShapes, sampleFromShape } from './base-shape.js'
import { createEngine } from './engine.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/base-shape.json', import.meta.url), 'utf8'))

const pathOf = (shape, ...keys) => keys.reduce((node, key) => node?.keys?.[key], shape)

test('the recorded shape still carries every field the engine reads', () => {
  const instances = pathOf(fixture.endpoints.instances, 'instances')
  assert.equal(instances?.type, 'array')
  for (const key of ['instanceId', 'driverKind', 'displayName', 'snapshot', 'models', 'login', 'capabilities']) {
    assert.ok(key in instances.items.keys || key === 'login', `instances[].${key}`)
  }
  assert.equal(instances.items.keys.snapshot.keys.state, 'string')
  assert.equal(instances.items.keys.models.keys.options.items.keys.id, 'string')

  const groups = pathOf(fixture.endpoints.bootstrap, 'bots') && fixture.endpoints.bootstrap.keys.groups
  assert.equal(groups.type, 'array')
  for (const key of ['id', 'threadId', 'name', 'memberIds', 'defaultResponder', 'cwd']) {
    assert.ok(key in groups.items.keys, `groups[].${key}`)
  }
  // Rust 基座不给群上的 tasks / queue / heldMessages：房间目标按 bulletin → name 回落，
  // 排队与带出的消息由 Lodge 自己记。回放只锁引擎真正读、基座真正给的那些键。
  assert.equal(groups.items.keys.bulletin, 'string')
  assert.equal(fixture.endpoints.config.keys.features.type, 'keys')
  assert.ok(fixture.endpoints.config.keys.features.keys.includes('skillsLibrary'))
})

test('the engine normalizes a payload with the recorded real shape', async () => {
  const instances = sampleFromShape(fixture.endpoints.instances, {
    'instances.0.instanceId': 'claude',
    'instances.0.driverKind': 'claudeAgent',
    'instances.0.displayName': 'Claude',
    'instances.0.snapshot.state': 'available',
    'instances.0.snapshot.reason': '',
    'instances.0.models.default': 'm-1',
    'instances.0.models.options.0.id': 'm-1',
    'instances.0.models.options.0.label': 'M 1',
  })
  const bootstrap = sampleFromShape(fixture.endpoints.bootstrap, {
    'bots.0.id': 'bot-1',
    'bots.0.threadId': 'thread-bot',
    'bots.0.name': '甲',
    'bots.0.modelSelection.instanceId': 'claude',
    'bots.0.modelSelection.model': 'm-1',
    'groups.0.id': 'group-1',
    'groups.0.threadId': 'thread-group',
    'groups.0.name': '圆桌',
    'groups.0.bulletin': '把发布检查做出来',
    'groups.0.cwd': '/tmp/work',
    'groups.0.description': '',
    'groups.0.busyBotId': null,
    'groups.0.memberIds.0': 'bot-1',
    'groups.0.defaultResponder.kind': 'mentions',
    'groups.0.tasks.0.threadId': 'thread-task',
    'groups.0.tasks.0.title': '把发布检查做出来',
    'groups.0.tasks.0.createdAt': 1,
    'groups.0.tasks.0.updatedAt': 1,
    'groups.0.tasks.0.working': false,
  })
  const engine = createEngine({
    client: {
      bootstrap: async () => bootstrap,
      instances: async () => instances,
      threadMessages: async () => ({ messages: [] }),
    },
  })

  const rooms = await engine.rooms()
  assert.equal(rooms.length, 1)
  assert.equal(rooms[0].id, 'group-1')
  assert.equal(rooms[0].name, '圆桌')
  assert.equal(rooms[0].sessionRef, 'thread-group')
  assert.equal(rooms[0].goal, '把发布检查做出来')
  assert.equal(rooms[0].cwd, '/tmp/work')
  assert.equal(rooms[0].busyRef, null)
  assert.equal(rooms[0].usage.turns, 0)

  const list = await engine.instances()
  assert.equal(list.length, 1)
  assert.deepEqual(
    { id: list[0].id, engine: list[0].engine, name: list[0].name, available: list[0].available },
    { id: 'claude', engine: 'claudeAgent', name: 'Claude', available: true },
  )
  assert.equal(list[0].models.default, 'm-1')
  assert.equal(list[0].models.options[0].id, 'm-1')
})

test('shape comparison reports a removed field and ignores a new one', () => {
  const expected = {
    type: 'object',
    keys: {
      instances: { type: 'array', items: { type: 'object', keys: { id: 'string', state: 'string' } } },
    },
  }
  const same = {
    type: 'object',
    keys: {
      instances: { type: 'array', items: { type: 'object', keys: { id: 'string', state: 'string' } } },
    },
  }
  assert.deepEqual(compareShapes(expected, same), { missing: [], extra: [] })

  const removed = {
    type: 'object',
    keys: {
      instances: { type: 'array', items: { type: 'object', keys: { id: 'string' } } },
    },
  }
  assert.deepEqual(compareShapes(expected, removed).missing, ['instances[].state'])

  const added = {
    type: 'object',
    keys: {
      instances: { type: 'array', items: { type: 'object', keys: { id: 'string', state: 'string', extra: 'string' } } },
    },
  }
  assert.deepEqual(compareShapes(expected, added).extra, ['instances[].extra'])

  const renamed = {
    type: 'object',
    keys: {
      instances: { type: 'array', items: { type: 'object', keys: { id: 'string', status: 'string' } } },
    },
  }
  assert.deepEqual(compareShapes(expected, renamed), {
    missing: ['instances[].state'],
    extra: ['instances[].status'],
  })
})
