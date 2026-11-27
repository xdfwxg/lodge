// 受限执行端点：证明/反例走这里。验证根校验、无网、超时、环境与凭据。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const port = 21600 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

if (process.platform !== 'darwin') {
  console.log('sandbox run: skipped (macOS only)')
  process.exit(0)
}

// 假 HOME 放在真实 HOME 下：临时目录是声明的执行根，不能用来证明“HOME 读不到”。
const home = mkdtempSync(join(homedir(), '.lodge-run-home-'))
const root = mkdtempSync(join(tmpdir(), 'lodge-run-root-'))
const work = join(root, 'work')
mkdirSync(work, { recursive: true })
mkdirSync(join(home, '.config', 'gh'), { recursive: true })
writeFileSync(join(home, '.config', 'gh', 'hosts.yml'), 'token: secret')

const child = spawn(bin, ['--port', String(port), '--db', join(root, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: {
    ...process.env,
    HOME: home,
    LODGE_WORK_ROOTS: root,
    GITHUB_TOKEN: 'platform-secret',
  },
})

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const run = async (body, { timeoutMs = 20_000 } = {}) => {
  const response = await fetch(`${baseUrl}/api/sandbox/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const payload = await response.json()
  return { status: response.status, payload }
}

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  // 1. 在声明根下执行，工作目录正确，输出带回。
  const ok = await run({ work, command: 'echo ok; pwd' })
  assert.equal(ok.status, 200)
  assert.equal(ok.payload.code, 0)
  assert.match(ok.payload.stdout, /ok/)
  assert.ok(ok.payload.stdout.includes(work) || ok.payload.stdout.includes(`/private${work}`))

  // 2. 根外目录一律拒绝。
  const outside = await run({ work: home, command: 'echo nope' })
  assert.equal(outside.status, 403)

  // 3. 平台凭据不进入子进程；PATH 照常。
  const env = await run({ work, command: 'printenv GITHUB_TOKEN || true; printenv PATH >/dev/null && echo path-ok' })
  assert.equal(env.payload.code, 0)
  assert.doesNotMatch(env.payload.stdout, /platform-secret/)
  assert.match(env.payload.stdout, /path-ok/)

  // 4. 凭据表里的文件读不到。
  const credential = await run({ work, command: 'cat "$HOME/.config/gh/hosts.yml"' })
  assert.notEqual(credential.payload.code, 0)
  assert.doesNotMatch(credential.payload.stdout, /secret/)

  // 5. 整轮不出网：直连 1.1.1.1 被边界拒绝。
  const network = await run({
    work,
    command: 'node -e "const s=require(\'net\').connect(80,\'1.1.1.1\');s.on(\'error\',e=>{console.log(e.code||\'error\');process.exit(0)});s.on(\'connect\',()=>{console.log(\'connected\');process.exit(0)});setTimeout(()=>{console.log(\'timeout\');process.exit(0)},4000)"',
  })
  assert.equal(network.payload.code, 0)
  assert.doesNotMatch(network.payload.stdout, /connected/)
  assert.match(network.payload.stdout, /EPERM|timeout/)

  // 6. 超时杀进程组，终态写清 timedOut。
  const slow = await run({ work, command: 'sleep 5', timeout_ms: 1_000 }, { timeoutMs: 15_000 })
  assert.equal(slow.payload.timedOut, true)
  assert.ok(slow.payload.durationMs < 4_000)

  // 7. 进程数上限：fork 出 8 个就整组停掉。
  const storm = await run({
    work,
    command: 'for i in 1 2 3 4 5 6 7 8; do sleep 30 & done; wait',
    max_processes: 4,
  }, { timeoutMs: 20_000 })
  assert.equal(storm.payload.killed, 'processes')
  assert.ok(storm.payload.durationMs < 10_000)

  // 8. 磁盘余量低于下限：拒绝开跑，不写到一半撑满盘。
  const floorPort = port + 500
  const floorChild = spawn(bin, ['--port', String(floorPort), '--db', join(root, 'floor.db')], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      HOME: home,
      LODGE_WORK_ROOTS: root,
      LODGE_MIN_FREE_BYTES: '999999999999999',
    },
  })
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${floorPort}/api/health`)).ok
      } catch {
        return false
      }
    }, 'floor health')
    const response = await fetch(`http://127.0.0.1:${floorPort}/api/sandbox/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ work, command: 'echo should-not-run' }),
    })
    assert.equal(response.status, 507)
    const payload = await response.json()
    assert.match(String(payload.error ?? ''), /磁盘余量不足/)
  } finally {
    floorChild.kill('SIGTERM')
  }

  console.log('base-rs sandbox run: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(home, { recursive: true, force: true })
  rmSync(root, { recursive: true, force: true })
}
