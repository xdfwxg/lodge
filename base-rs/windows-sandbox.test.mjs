// Windows 沙箱：安装态、box 字段，以及受限执行里“以谁的身份跑、能写哪里、能读哪里、能不能出网”。
// 没装沙箱时明确跳过；不把“没装”当成通过。真机验证在这份测试里，不在代码注释里。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

if (process.platform !== 'win32') {
  console.log('windows sandbox: skipped (Windows only)')
  process.exit(0)
}

let status = ''
try {
  status = execFileSync(bin, ['--sandbox-status'], { encoding: 'utf8' })
} catch (error) {
  if (error?.code === 'ENOENT') {
    console.error(`windows sandbox: base binary missing at ${bin}; build it first`)
    process.exit(1)
  }
  console.log(`windows sandbox: skipped (not installed; run "${bin}" --sandbox-install as administrator)`)
  process.exit(0)
}
if (!/账户：.* 在/.test(status) || !/密码文件：在/.test(status)) {
  console.log(`windows sandbox: skipped (install incomplete)\n${status}`)
  process.exit(0)
}
const user = process.env.LODGE_SANDBOX_USER ?? 'LodgeSandbox'

const port = 21600 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const root = mkdtempSync(join(tmpdir(), 'lodge-win-sandbox-'))
const work = join(root, 'work')
mkdirSync(work, { recursive: true })
const canary = join(homedir(), `lodge-win-canary-${process.pid}.txt`)
writeFileSync(canary, 'owner-secret')
const sibling = join(root, 'sibling')
mkdirSync(sibling, { recursive: true })
writeFileSync(join(sibling, 'note.txt'), 'sibling-secret')

const child = spawn(bin, ['--port', String(port), '--db', join(root, 'base.db')], {
  stdio: ['ignore', 'inherit', 'inherit'],
  env: { ...process.env, LODGE_WORK_ROOTS: root },
})

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const run = async (body, { timeoutMs = 30_000 } = {}) => {
  const response = await fetch(`${baseUrl}/api/sandbox/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: response.status, payload: await response.json() }
}

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  // 装好了，health 要如实说 on。
  const health = await (await fetch(`${baseUrl}/api/health`)).json()
  assert.equal(health.box, 'on', 'installed sandbox reports box=on')

  // 1. 命令以专用账户运行，不是当前用户。
  const who = await run({ work, command: 'whoami' })
  assert.equal(who.payload.code, 0)
  assert.match(who.payload.stdout, new RegExp(user, 'i'))

  // 2. 成员自己的副本可写。
  const inside = await run({ work, command: 'echo ok>inside.txt && type inside.txt' })
  assert.equal(inside.payload.code, 0)
  assert.match(inside.payload.stdout, /ok/)

  // 3. 副本以外不可写（这里用它的上一级）。
  const outside = await run({ work, command: 'echo nope>..\\outside.txt' })
  assert.notEqual(outside.payload.code, 0, 'a write outside the work copy fails')

  // 4. 读不到当前用户 HOME 里的东西（专用账户不是它的所有者）。
  const read = await run({ work, command: `type "${canary}"` })
  assert.notEqual(read.payload.code, 0, 'the owner home is not readable')
  assert.doesNotMatch(read.payload.stdout, /owner-secret/)

  // 5. 同根下别的目录和基座自己的库都读不到（只授权了成员副本和回合临时目录）。
  const siblingRead = await run({ work, command: `type "${join(sibling, 'note.txt')}"` })
  assert.notEqual(siblingRead.payload.code, 0, 'a sibling directory is not readable')
  assert.doesNotMatch(siblingRead.payload.stdout, /sibling-secret/)
  const databaseRead = await run({ work, command: `type "${join(root, 'base.db')}"` })
  assert.notEqual(databaseRead.payload.code, 0, 'the base database is not readable')

  // 6. 直连外网被 WFP 拦下。
  const network = await run({
    work,
    command: 'node -e "const s=require(\'net\').connect(80,\'1.1.1.1\');s.on(\'error\',e=>{console.log(e.code||\'error\');process.exit(0)});s.on(\'connect\',()=>{console.log(\'connected\');process.exit(0)});setTimeout(()=>{console.log(\'timeout\');process.exit(0)},4000)"',
  })
  assert.equal(network.payload.code, 0)
  assert.doesNotMatch(network.payload.stdout, /connected/)
  assert.match(network.payload.stdout, /ECONNREFUSED|EACCES|EPERM|timeout/)
} finally {
  child.kill('SIGTERM')
  try { rmSync(canary, { force: true }) } catch {}
  try { rmSync(root, { recursive: true, force: true }) } catch {}
}
console.log('windows sandbox: ok')
