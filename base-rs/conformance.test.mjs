// 形状一致性：同一份只读检查对旧基座和新基座都能跑。
// 用法：node base-rs/conformance.test.mjs [--base http://127.0.0.1:8799]
// 不带 --base 时，起一个本地薄基座（--fake）来跑。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', 'lodge-base-slice')
const args = process.argv.slice(2)
const baseIndex = args.indexOf('--base')
const external = baseIndex >= 0 ? args[baseIndex + 1] : null
const port = 20000 + Math.floor(Math.random() * 500)
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-conformance-'))
const baseUrl = external ?? `http://127.0.0.1:${port}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = external === null
  ? spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db'), '--fake'], { stdio: ['ignore', 'inherit', 'inherit'] })
  : null

const readEventStream = async (url, timeoutMs = 4000) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${url}/api/events`, {
      headers: { accept: 'text/event-stream' },
      signal: controller.signal,
    })
    assert.equal(response.ok, true)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let hello = false
    let withId = false
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, cut)
        buffer = buffer.slice(cut + 2)
        if (block.includes('id:')) withId = true
        const data = block
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')
        if (data !== '') {
          try {
            if (JSON.parse(data).kind === 'hello') hello = true
          } catch {}
        }
        if (hello || withId) return { hello, withId }
      }
    }
    return { hello, withId }
  } catch (error) {
    if (controller.signal.aborted) return { hello: false, withId: false }
    throw error
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  const instances = await (await fetch(`${baseUrl}/api/instances`)).json()
  assert.ok(Array.isArray(instances.instances), 'instances is an array')
  for (const instance of instances.instances) {
    assert.equal(typeof instance.instanceId, 'string')
    assert.equal(typeof instance.driverKind, 'string')
    assert.equal(typeof instance.models, 'object')
  }

  const bootstrap = await (await fetch(`${baseUrl}/api/bots?messages=0`)).json()
  assert.ok(Array.isArray(bootstrap.bots), 'bootstrap.bots is an array')
  assert.ok(Array.isArray(bootstrap.groups), 'bootstrap.groups is an array')
  for (const group of bootstrap.groups) {
    assert.equal(typeof group.id, 'string')
    assert.equal(typeof group.threadId, 'string')
  }

  const config = await (await fetch(`${baseUrl}/api/config`)).json()
  assert.equal(typeof config, 'object')

  const stream = await readEventStream(baseUrl)
  assert.ok(stream.hello || stream.withId, 'events stream speaks SSE with hello or id frames')

  console.log(`conformance: ok (base=${baseUrl}, instances=${instances.instances.length}, hello=${stream.hello})`)
} finally {
  child?.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
