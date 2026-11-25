import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  baseBoxEnv, baseEntryOf, findBundledRuntimes, findNode, findPort, isBaseUp, readRuntime, runtimeRoots, waitForHealth,
} from './launch.mjs'

const temp = () => mkdtempSync(join(tmpdir(), 'lodge-electron-launch-'))

test('the app starts its base with the bot box and sibling isolation on macOS', () => {
  assert.deepEqual(baseBoxEnv({ env: {}, platform: 'darwin' }), {
    OMB_BOT_BOX: '1',
    OMB_BOT_BOX_DENY_SIBLINGS: '1',
  })
  // 用户显式关掉时不再强开；另一个开关仍取默认。
  assert.deepEqual(baseBoxEnv({ env: { OMB_BOT_BOX: '0' }, platform: 'darwin' }), {
    OMB_BOT_BOX: '0',
    OMB_BOT_BOX_DENY_SIBLINGS: '1',
  })
  assert.deepEqual(baseBoxEnv({ env: {}, platform: 'linux' }), {})
})

test('a bundled base wins over a source checkout', () => {
  const dir = temp()
  try {
    assert.equal(baseEntryOf(dir), null)
    mkdirSync(join(dir, 'server'))
    writeFileSync(join(dir, 'server', 'openmausbot.ts'), '')
    assert.deepEqual(baseEntryOf(dir), { kind: 'source', file: join(dir, 'server', 'openmausbot.ts') })
    mkdirSync(join(dir, 'dist-server'))
    writeFileSync(join(dir, 'dist-server', 'openmausbot.js'), '')
    assert.deepEqual(baseEntryOf(dir), { kind: 'bundled', file: join(dir, 'dist-server', 'openmausbot.js') })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('runtime manifests must stay inside their own directory', () => {
  const root = temp()
  try {
    const runtime = join(root, 'pi')
    mkdirSync(runtime)
    writeFileSync(join(runtime, 'pi'), '#!/bin/sh\n')
    writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ id: 'pi', binary: 'pi' }))
    const found = readRuntime(runtime)
    assert.equal(found.id, 'pi')
    assert.equal(found.dir, runtime)
    assert.match(found.binaryPath, /\/pi$/)

    writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ id: '../escape', binary: 'pi' }))
    assert.equal(readRuntime(runtime), null)
    writeFileSync(join(runtime, 'runtime.json'), JSON.stringify({ id: 'pi', binary: '../outside' }))
    assert.equal(readRuntime(runtime), null)
    writeFileSync(join(runtime, 'runtime.json'), '{')
    assert.equal(readRuntime(runtime), null)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('bundled runtimes dedupe by id and sort across roots', () => {
  const first = temp()
  const second = temp()
  try {
    for (const [root, id] of [[first, 'pi'], [second, 'qwen'], [second, 'pi']]) {
      const dir = join(root, id)
      mkdirSync(dir)
      writeFileSync(join(dir, id), '#!/bin/sh\n')
      writeFileSync(join(dir, 'runtime.json'), JSON.stringify({ id, binary: id }))
    }
    const found = findBundledRuntimes({ roots: [first, second, join(first, 'missing')] })
    assert.deepEqual(found.map(item => item.id), ['pi', 'qwen'])
    assert.equal(found[0].dir, join(first, 'pi'))
  } finally {
    rmSync(first, { recursive: true, force: true })
    rmSync(second, { recursive: true, force: true })
  }
})

test('runtime roots put explicit directories before the app bundle', () => {
  assert.deepEqual(runtimeRoots({
    env: { LODGE_RUNTIMES_DIR: '/one:/two' },
    isPackaged: true,
    resourcesPath: '/app/Resources',
    appPath: '/app',
  }), ['/one', '/two', '/app/Resources/runtimes'])
  assert.deepEqual(runtimeRoots({
    env: {},
    isPackaged: false,
    resourcesPath: '/unused',
    appPath: '/repo',
  }), ['/repo/build/runtimes'])
})

test('findNode prefers an explicit binary, then PATH', () => {
  assert.equal(findNode({
    env: { LODGE_NODE: '/explicit/node' },
    exists: path => path === '/explicit/node',
  }), '/explicit/node')
  assert.equal(findNode({ env: {}, exists: () => false, home: '/home/u', exec: () => '/path/node\n' }), '/path/node')
  assert.equal(findNode({
    env: {},
    exists: () => false,
    exec: () => { throw new Error('missing') },
  }), null)
})

test('a port and health probe are real, not assumed', async () => {
  const port = await findPort(47_100)
  assert.ok(Number.isInteger(port) && port > 0)
  assert.equal(await waitForHealth(port, { attempts: 2, interval: 1 }), false)

  const server = createServer((request, response) => {
    response.writeHead(request.url === '/api/health' ? 200 : 404)
    response.end('{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const live = server.address().port
  try {
    assert.equal(await waitForHealth(live), true)
    assert.equal(await isBaseUp(`http://127.0.0.1:${live}`), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})

test('isBaseUp requires a base-shaped instance list', async () => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(request.url === '/api/instances' ? JSON.stringify({ instances: [] }) : '{}')
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  try {
    assert.equal(await isBaseUp(`http://127.0.0.1:${port}/`), true)
    assert.equal(await isBaseUp(''), false)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
