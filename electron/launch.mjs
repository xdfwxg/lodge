import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { runtimeBinary } from './policy.mjs'

export const RUNTIME_ID = /^[\w-]{1,64}$/

// 端口、基座入口和 runtime 清单都是“启动前的事实”，从 Electron 本体里分出来测。
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

export const findNode = ({
  env = process.env,
  exists = existsSync,
  home = homedir(),
  exec = execFileSync,
} = {}) => {
  if (typeof env.LODGE_NODE === 'string' && exists(env.LODGE_NODE)) return env.LODGE_NODE
  const candidates = [
    '/usr/local/bin/node',
    '/opt/homebrew/bin/node',
    join(home, '.local/bin/node'),
    join(home, '.nvm/current/bin/node'),
  ]
  for (const candidate of candidates) if (exists(candidate)) return candidate
  try {
    return exec('which', ['node'], { encoding: 'utf8', timeout: 2_000 }).trim()
  } catch {
    return null
  }
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

export const baseEntryOf = (dir, { exists = existsSync } = {}) => {
  const bundled = join(dir, 'dist-server', 'openmausbot.js')
  if (exists(bundled)) return { kind: 'bundled', file: bundled }
  const source = join(dir, 'server', 'openmausbot.ts')
  if (exists(source)) return { kind: 'source', file: source }
  return null
}
