// 正常退出不留驱动孤儿：SIGTERM 清掉进程组，pgrep 应为空。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 21000 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-orphan-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const countFakePi = () => {
  try {
    const output = execFileSync('pgrep', ['-f', fakePi], { encoding: 'utf8' })
    return output.trim().split('\n').filter(Boolean).length
  } catch (error) {
    if (error?.status === 1) return 0
    return null
  }
}

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    const value = await check()
    if (value) return value
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db')],
  { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, LODGE_PI_BIN: fakePi } },
)

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  const client = createBaseClient({ baseUrl })
  const bot = (await client.createBot({
    name: 'pi',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { lease: { read: [], write: [], exec: false, network: [] } },
  })).bot
  const group = (await client.createGroup({ name: '孤儿房', memberIds: [bot.id] })).group
  await client.sendGroupMessage(group.id, '慢')
  await waitFor(() => countFakePi() >= 1, 'fake pi running')

  // SIGKILL 是最坏情况：基座自己来不及清理，看门人发现被过继后杀掉整组。
  const exited = new Promise(resolve => child.once('exit', resolve))
  child.kill('SIGKILL')
  await exited
  await waitFor(() => countFakePi() === 0, 'supervisor reaps orphan', 60)
  assert.equal(countFakePi(), 0, 'no fake pi process is left after SIGKILL')
  console.log('base-rs orphan: ok')
} finally {
  child.kill('SIGKILL')
  rmSync(dataDir, { recursive: true, force: true })
}
