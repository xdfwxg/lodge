import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer, connect } from 'node:net'
import { delimiter, join } from 'node:path'
import { runtimeBinary } from './policy.mjs'

export const RUNTIME_ID = /^[\w-]{1,64}$/

// 从外面连一次端口：`open` 在接、`refused` 端口后面真的没了、`busy` 连得上但没响应（循环忙）。
// 判定必须发生在被监督的进程之外——服务自己的自检会在故障时给出相反的答案。
export const probePort = (port, { host = '127.0.0.1', timeoutMs = 1_500 } = {}) => new Promise(resolve => {
  const socket = connect({ host, port })
  let settled = false
  const done = state => {
    if (settled) return
    settled = true
    socket.destroy()
    resolve(state)
  }
  socket.setTimeout(timeoutMs)
  socket.once('connect', () => done('open'))
  socket.once('timeout', () => done('busy'))
  socket.once('error', error => done(error?.code === 'ECONNREFUSED' ? 'refused' : 'busy'))
})

// 端口、基座健康检查和 runtime 清单都是“启动前的事实”，从 Electron 本体里分出来测。
export const findPort = start => new Promise(resolve => {
  const probe = createServer()
  probe.once('error', () => resolve(findPort(start + 1)))
  probe.listen(start, '127.0.0.1', () => {
    const port = probe.address()?.port ?? start
    probe.close(() => resolve(port))
  })
})

export const waitForHealth = async (port, {
  attempts = 80,
  interval = 250,
  fetchImpl = fetch,
  timeout = 1_000,
} = {}) => {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const response = await fetchImpl(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(timeout) })
      if (response.ok) return true
    } catch {}
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return false
}

export const isBaseUp = async (url, { fetchImpl = fetch, timeout = 1_500 } = {}) => {
  if (typeof url !== 'string' || url === '') return false
  try {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/api/instances`, { signal: AbortSignal.timeout(timeout) })
    if (!response.ok) return false
    const data = await response.json()
    return Array.isArray(data?.instances)
  } catch {
    return false
  }
}

export const waitForBase = async (url, { attempts = 80, interval = 250, fetchImpl = fetch } = {}) => {
  for (let index = 0; index < attempts; index += 1) {
    if (await isBaseUp(url, { fetchImpl })) return true
    await new Promise(resolve => setTimeout(resolve, interval))
  }
  return false
}


export const runtimeRoots = ({ env = process.env, isPackaged, resourcesPath, appPath }) => [
  ...(typeof env.LODGE_RUNTIMES_DIR === 'string'
    ? env.LODGE_RUNTIMES_DIR.split(delimiter).filter(Boolean)
    : []),
  isPackaged
    ? join(resourcesPath, 'runtimes')
    : join(appPath, 'build', 'runtimes'),
]

export const readRuntime = (dir, { exists = existsSync, read = readFileSync } = {}) => {
  try {
    const manifest = JSON.parse(read(join(dir, 'runtime.json'), 'utf8'))
    if (typeof manifest?.id !== 'string' || !RUNTIME_ID.test(manifest.id)) return null
    if (typeof manifest.binary !== 'string' || manifest.binary === '') return null
    const binaryPath = runtimeBinary(dir, manifest.binary)
    if (binaryPath === null) return null
    return { ...manifest, dir, binaryPath }
  } catch {
    return null
  }
}

export const findBundledRuntimes = ({ roots, readdir = readdirSync } = {}) => {
  const found = new Map()
  for (const root of roots ?? []) {
    let entries = []
    try {
      entries = readdir(root, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const runtime = readRuntime(join(root, entry.name))
      if (runtime !== null && !found.has(runtime.id)) found.set(runtime.id, runtime)
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}

