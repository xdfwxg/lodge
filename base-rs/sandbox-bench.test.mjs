// 沙箱基准：把“优秀”写成可执行断言。全绿才算达标；红一条就是缺口。
// 每一轮都跑两遍：沙箱开、沙箱关。开的那遍证明边界在拦，关的那遍证明探针真的有东西可拦——
// 没有负对照，探针可能只是在读一个不存在的文件，绿得毫无意义。
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const repo = join(dir, '..')
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

if (process.platform !== 'darwin') {
  console.log('sandbox bench: skipped (macOS only)')
  process.exit(0)
}

const waitFor = async (check, label, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const seed = (path, text = 'probe') => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)
}

// 一轮完整的探针：独立库、独立假 HOME、独立工作副本，跑完即清。
const runProbes = async ({ label, sandboxed, strict = false, basePort }) => {
  // 假 HOME 必须放在真实 HOME 下：临时目录本身是可写根，探针会假绿。
  const home = mkdtempSync(join(homedir(), `.lodge-bench-${label}-`))
  const root = mkdtempSync(join(tmpdir(), `lodge-bench-${label}-`))
  const work = join(root, 'work')
  const sibling = join(root, 'sibling')
  const otherRoom = join(root, 'other-room')
  const dataDir = join(root, 'data')
  const dbPath = join(dataDir, 'base.db')
  // 另一个回合的临时目录：里面有引擎目录的凭据拷贝，本回合不该读、也不该写。
  const otherScratch = join(tmpdir(), 'lodge-turns', `bench-${label}`)
  const port = basePort + Math.floor(Math.random() * 200)

  seed(join(home, '.ssh', 'id_ed25519'))
  seed(join(home, '.aws', 'credentials'))
  seed(join(home, '.gnupg', 'private-keys-v1.d', 'probe.key'))
  seed(join(home, '.config', 'gh', 'hosts.yml'))
  seed(join(home, '.npmrc'))
  seed(join(home, '.netrc'))
  seed(join(home, '.cargo', 'credentials.toml'))
  seed(join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'Default', 'Cookies'))
  seed(join(home, 'notes.txt'), 'notes')
  // 能力契约的最小工作台：一个能 npm test 的项目、一个有 .git 的工作副本。
  mkdirSync(work, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: work })
  seed(join(work, 'package.json'), JSON.stringify({ name: 'bench', private: true, scripts: { test: 'node test.js' } }))
  seed(join(work, 'test.js'), "require('node:assert/strict').equal(1 + 1, 2)\n")
  seed(join(sibling, 'secret.txt'))
  seed(join(otherRoom, 'secret.txt'))
  seed(join(otherScratch, 'secret.txt'))
  mkdirSync(dataDir, { recursive: true })

  const child = spawn(bin, ['--port', String(port), '--db', dbPath], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      HOME: home,
      LODGE_PI_BIN: fakePi,
      LODGE_SANDBOX: sandboxed ? 'on' : 'off',
      // 平台自己的凭据和令牌：孩子里一个都不该出现，开不开沙箱都一样。
      LODGE_BENCH_TOKEN: 'bench-platform-secret',
      GITHUB_TOKEN: 'bench-github-token',
      ANTHROPIC_API_KEY: 'bench-provider-key',
    },
  })

  const baseUrl = `http://127.0.0.1:${port}`
  const client = createBaseClient({ baseUrl })
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`${baseUrl}/api/health`)).ok
      } catch {
        return false
      }
    }, 'health')

    const probeBot = (await client.createBot({
      name: '基准成员',
      modelSelection: { instanceId: 'pi', model: '' },
      settings: {
      cwd: work,
      nativeTools: [],
      limits: { fileBytes: 8 * 1024 * 1024 },
      ...(strict ? { profile: 'strict' } : {}),
    },
    })).bot
    const siblingBot = (await client.createBot({
      name: '兄弟成员',
      modelSelection: { instanceId: 'pi', model: '' },
      settings: { cwd: sibling, nativeTools: [] },
    })).bot
    const group = (await client.createGroup({ name: `基准房-${label}`, memberIds: [probeBot.id, siblingBot.id] })).group
    await client.setupGroup(group.id, {
      action: 'complete',
      cwd: work,
      bulletin: '基准',
      defaultResponder: { kind: 'member', botId: probeBot.id },
      followMentions: false,
    })
    // 别的房间：同一台机器上另一个成员的工作副本，本回合不该读到。
    const otherBot = (await client.createBot({
      name: '别的房间成员',
      modelSelection: { instanceId: 'pi', model: '' },
      settings: { cwd: otherRoom, nativeTools: [] },
    })).bot
    const otherGroup = (await client.createGroup({ name: `别的房间-${label}`, memberIds: [otherBot.id] })).group
    await client.setupGroup(otherGroup.id, {
      action: 'complete',
      cwd: otherRoom,
      bulletin: '别的房间',
      defaultResponder: { kind: 'member', botId: otherBot.id },
      followMentions: false,
    })

    await client.sendGroupMessage(group.id, `基准:${JSON.stringify({
      db: dbPath,
      realHome: home,
      sibling: join(sibling, 'secret.txt'),
      otherRoom: join(otherRoom, 'secret.txt'),
      otherScratch: join(otherScratch, 'secret.txt'),
      port,
      basePid: child.pid,
    })}`)
    let probes = null
    await waitFor(async () => {
      const page = await client.threadMessages(group.threadId)
      const message = page.messages.find(item => String(item.text ?? '').startsWith('bench:'))
      if (!message) return false
      probes = JSON.parse(message.text.slice('bench:'.length))
      return true
    }, 'bench probes')
    const health = await (await fetch(`${baseUrl}/api/health`)).json()
    return { probes, health }
  } finally {
    child.kill('SIGTERM')
    rmSync(home, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    rmSync(otherScratch, { recursive: true, force: true })
  }
}

// 沙箱开的期望：每一条都是“边界必须拦住/必须允许”的判据。
const expected = {
  workWrite: 'ok',
  homeWrite: 'denied',
  gitWrite: 'denied',
  sshRead: 'denied',
  awsRead: 'denied',
  gnupgRead: 'denied',
  ghRead: 'denied',
  npmrcRead: 'denied',
  netrcRead: 'denied',
  cargoRead: 'denied',
  chromeRead: 'denied',
  homeNoteRead: 'allowed',
  baseDbRead: 'denied',
  siblingRead: 'denied',
  otherRoomRead: 'denied',
  otherScratchRead: 'denied',
  hardlink: 'denied',
  nodeRun: 'ok',
  npmTestOffline: 'ok',
  gitStatus: 'ok',
  gitCommit: 'denied',
  fileCap: 'capped',
  localBind: 'denied',
  directBase: 'denied',
  proxyBase: 'denied',
  directInternet: 'denied',
  proxyInternet: 'denied',
  envPath: 'present',
  envPlatform: 'absent',
  envProvider: 'absent',
  envGithub: 'absent',
  signalOutside: 'denied',
  signalChild: 'allowed',
}

// 沙箱关的负对照：这些必须反过来，证明探针真的碰到了东西，而不是读了个不存在的路径。
const control = {
  workWrite: 'ok',
  homeWrite: 'ok',
  gitWrite: 'ok',
  sshRead: 'allowed',
  awsRead: 'allowed',
  gnupgRead: 'allowed',
  ghRead: 'allowed',
  npmrcRead: 'allowed',
  netrcRead: 'allowed',
  cargoRead: 'allowed',
  chromeRead: 'allowed',
  homeNoteRead: 'allowed',
  baseDbRead: 'allowed',
  siblingRead: 'allowed',
  otherRoomRead: 'allowed',
  otherScratchRead: 'allowed',
  hardlink: 'linked',
  nodeRun: 'ok',
  npmTestOffline: 'ok',
  gitStatus: 'ok',
  gitCommit: 'committed',
  fileCap: 'uncapped',
  localBind: 'bound',
  directBase: 'connected',
  signalOutside: 'allowed',
  signalChild: 'allowed',
  proxyBase: 'denied',
  proxyInternet: 'denied',
  envPath: 'present',
  envPlatform: 'absent',
  envProvider: 'absent',
  envGithub: 'absent',
}

// 严格档：HOME 里的普通文件也读不到；其余边界与标准档一致。
const strictExpected = { ...expected, homeNoteRead: 'denied' }

const matches = (actual, want) => {
  if (want === 'denied') return String(actual).startsWith('denied:')
  if (want === 'uncapped') return String(actual).startsWith('uncapped')
  return actual === want
}
const verdict = (name, want, actual) => ({
  name,
  pass: matches(actual, want),
  detail: `expected ${want}, got ${actual ?? 'missing'}`,
})

const report = (title, results) => {
  const green = results.filter(item => item.pass).length
  console.log(`\n${title}: ${green}/${results.length} green`)
  for (const item of results) {
    console.log(`  ${item.pass ? '✔' : '✘'} ${item.name}${item.pass ? '' : ` — ${item.detail}`}`)
  }
  return green === results.length
}

const on = await runProbes({ label: 'on', sandboxed: true, basePort: 20500 })
  const off = await runProbes({ label: 'off', sandboxed: false, basePort: 20900 })
  const strict = await runProbes({ label: 'strict', sandboxed: true, strict: true, basePort: 21300 })

  const onResults = Object.entries(expected).map(([name, want]) => verdict(name, want, on.probes[name]))

  // 静态门禁：server/ 里每一个能 spawn 进程的文件都必须登记在案，并且写明为什么它不是 agent 命令。
  // 新出现一个未登记的执行点就红；登记表里有已经不存在的文件也红。
  const filesUnder = root => readdirSync(root, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? filesUnder(join(root, entry.name)) : [join(root, entry.name)])
  const execUsers = filesUnder(join(repo, 'server', 'crew'))
    .filter(file => file.endsWith('.js') && !file.endsWith('.test.js'))
    .filter(file => /from 'node:child_process'/.test(readFileSync(file, 'utf8')))
    .map(file => file.slice(repo.length + 1))
  const platformExec = new Map([
    ['server/crew/paths.js', 'git rev-parse，参数由平台给'],
    ['server/crew/workspace-git.js', '房间仓库的 git 操作，参数由平台给'],
    ['server/crew/workspace-ports.js', 'lsof 查端口'],
    ['server/crew/screenshot.js', '本机 Chrome 渲染本地 HTML：页面走 data: 来源（读不到 file://）+ 网络 flags，screenshot.test.js 锁住'],
    ['server/crew/visual-audit.js', 'sips 读图片'],
  ])
  const unknownExec = execUsers.filter(file => !platformExec.has(file))
  const staleExec = [...platformExec.keys()].filter(file => !execUsers.includes(file))
  onResults.push({
    name: 'entryGate',
    pass: unknownExec.length === 0 && staleExec.length === 0,
    detail: unknownExec.length
      ? `任务命令在边界外出生：${unknownExec.join(', ')}`
      : `登记表里有已不存在或不再 spawn 的文件：${staleExec.join(', ')}`,
  })
  const piSource = readFileSync(join(dir, 'src', 'drivers', 'pi.rs'), 'utf8')
  const seatbelt = readFileSync(join(dir, 'src', 'sandbox', 'seatbelt.rs'), 'utf8')
  onResults.push({
    name: 'singleSource',
    pass: !piSource.includes('/usr/bin/sandbox-exec') && seatbelt.includes('/usr/bin/sandbox-exec'),
    detail: 'the platform backend lives only in sandbox/seatbelt.rs',
  })
  onResults.push({
    name: 'health',
    pass: on.health.box === 'on' && on.health.egress === 'proxy',
    detail: `box=${on.health.box} egress=${on.health.egress}`,
  })

  const offResults = Object.entries(control).map(([name, want]) => verdict(name, want, off.probes[name]))
  const strictResults = Object.entries(strictExpected).map(([name, want]) => verdict(name, want, strict.probes[name]))

  const onOk = report('sandbox bench', onResults)
  const offOk = report('negative control (sandbox off)', offResults)
  const strictOk = report('sandbox bench (strict)', strictResults)
  if (!onOk || !offOk || !strictOk) {
    console.log('\n未达标：红的每一条都是缺口，不是噪音。')
    process.exitCode = 1
  }
