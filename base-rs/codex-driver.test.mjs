// codex 驱动映射：用 fake-codex 说同一套 `codex exec --json` 事件，确定性地验证
// 终态、用量、失败、凭据注入、预算与进程组。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakeCodex = join(dir, process.platform === 'win32' ? 'fake-codex.cmd' : 'fake-codex.mjs')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 20400 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-codex-'))
const keyFile = join(dataDir, 'deepseek.key')
const fakeKey = 'sk-fake-codex-key'
chmodSync(fakeCodex, 0o755)
// 文件带一个尾换行：驱动要去掉它，再只注入给 codex 子进程。
writeFileSync(keyFile, `${fakeKey}\n`, { mode: 0o600 })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const countFakeCodex = () => {
  try {
    return execFileSync('pgrep', ['-f', fakeCodex], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .length
  } catch {
    return 0
  }
}

// 找真正跑 fake-codex 的进程（排除外层的 --supervise 看门人），返回 [pid, pgid]。
const fakeProcess = () => {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter(line => line.includes(fakeCodex) && !line.includes('--supervise'))
    const row = rows[0]?.trim()
    if (!row) return null
    const [pid, pgid] = row.split(/\s+/)
    return [Number(pid), Number(pgid)]
  } catch {
    return null
  }
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db')],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
      LODGE_CODEX_BIN: fakeCodex,
      LODGE_CODEX_KEY_FILE: keyFile,
      LODGE_PI_BIN: fakePi,
      LODGE_SANDBOX: 'on',
    },
  },
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

  // 发现：有二进制就 available，driverKind 是 codex，模型报 DeepSeek Chat。
  const instance = (await client.instances()).instances.find(item => item.instanceId === 'codex')
  assert.ok(instance, 'codex is discovered')
  assert.equal(instance.snapshot.state, 'available')
  assert.equal(instance.driverKind, 'codex')
  assert.equal(instance.models.default, 'deepseek-chat')
  assert.equal(instance.models.options[0]?.id, 'deepseek-chat')
  assert.equal(instance.capabilities?.approvalReview, false, 'v1 has no approval cards')
  assert.equal(instance.capabilities?.streaming, false, 'v1 has no content deltas')

  const baseSettings = { lease: { read: [], write: [], exec: false, network: [] } }
  const bot = async (name, settings = {}) => (await client.createBot({
    name,
    modelSelection: { instanceId: 'codex', model: 'deepseek-chat' },
    settings: { ...baseSettings, ...settings },
  })).bot
  const echoBot = await bot('codex 聊天成员', { soul: '你是小陈，说话简短。' })
  const errorBot = await bot('错误成员')
  const noResultBot = await bot('无终态成员')
  const errorItemBot = await bot('错误项成员')
  const budgetBot = await bot('预算成员', { budget: { maxMs: 1500 } })
  const keyBot = await bot('凭据成员')
  // 技能正文不进提示词：清单进提示词，正文由一个只有 use_skill 的 MCP 服务器现取。
  await client.importLibrarySkill('---\nname: lodge-build\n---\n# Build\n先跑最小切片。正文标记 SKILL-BODY-6260')
  await client.approveLibrarySkill('lodge-build')
  const skillBot = await bot('技能成员')
  await client.setBotSkills(skillBot.id, ['lodge-build'])

  const group = (await client.createGroup({
    name: 'codex 契约房',
    memberIds: [echoBot.id, errorBot.id, noResultBot.id, errorItemBot.id, budgetBot.id, keyBot.id, skillBot.id],
  })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: 'codex',
    defaultResponder: { kind: 'member', botId: echoBot.id },
    followMentions: false,
  })

  const messages = async () => (await client.threadMessages(group.threadId)).messages
  const send = (text, target) => client.sendGroupMessage(group.id, text, { mentions: [target.id] })
  const waitSince = async (from, check, label, tries) => {
    await waitFor(async () => {
      const list = await messages()
      return check(list.slice(from), list)
    }, label, tries)
  }
  const digestSince = async from => {
    const list = await messages()
    return list.slice(from).find(message => message.kind === 'digest')
  }

  // 1. 普通回合：多条 agent_message 累加；非致命的 item.type=error 告警不把回合判死；
  //    usage 从 turn.completed 映射（input / cached_input / output）。
  let from = (await messages()).length
  await send('hello', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && message.text === 'codex: hello'), 'codex text')
  await waitSince(from, list => list.some(message => message.kind === 'digest'), 'codex digest')
  const completed = await digestSince(from)
  assert.equal(completed.digest.stopReason, 'completed')
  assert.deepEqual(completed.digest.usage, { input: 11, output: 7, cacheRead: 5 })

  // 2. 命令形状：只读沙箱、JSONL、跳过 git 检查、DeepSeek provider 配置、模型名都到 CLI。
  from = (await messages()).length
  await send('参数', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).startsWith('args:')), 'command shape')
  const args = JSON.parse(String((await messages()).slice(from).find(message => String(message.text ?? '').startsWith('args:')).text).slice(5))
  assert.equal(args.model, 'deepseek-chat')
  assert.equal(args.sandbox, 'danger-full-access', 'the base sandbox is the boundary; codex must not nest its own')
  assert.equal(args.json, true, 'events are JSONL')
  assert.equal(args.skipGitRepoCheck, true)
  assert.equal(args.provider, 'deepseek')
  assert.equal(args.providerName, 'DeepSeek')
  assert.equal(args.providerBaseUrl, 'https://api.deepseek.com/v1')
  assert.equal(args.providerEnvKey, 'DEEPSEEK_API_KEY')
  assert.equal(args.providerWireApi, 'responses', 'this codex version only accepts responses')
  assert.match(String(args.codexHome), /codex$/, 'every turn gets its own CODEX_HOME')
  assert.equal(args.skillFile, false, 'no skills means no skill directory')

  // 2b. 有技能时：每回合一个隔离的 CODEX_HOME，技能按目录放进去，清单和正文都由 codex 自己管。
  from = (await messages()).length
  await send('参数', skillBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).startsWith('args:')), 'skill home')
  const skillArgs = JSON.parse(String((await messages()).slice(from).find(message => String(message.text ?? '').startsWith('args:')).text).slice(5))
  assert.equal(skillArgs.skillFile, true, 'the skill lands in the per-turn CODEX_HOME')

  from = (await messages()).length
  await send('系统', skillBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).startsWith('system:')), 'soul only')
  const skillSystem = String((await messages()).slice(from).find(message => String(message.text ?? '').startsWith('system:')).text).slice(7)
  assert.ok(!skillSystem.includes('SKILL-BODY-6260'), 'the body never enters the prompt')
  assert.ok(!skillSystem.includes('lodge-build'), 'the catalog is the engine\'s own, not ours')

  // 3. soul 与房间上下文随提示词一起给（codex 没有 --append-system-prompt）。
  from = (await messages()).length
  await send('系统', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text'
    && String(message.text).includes('system:')
    && String(message.text).includes('你是小陈，说话简短。')), 'soul reaches codex')

  from = (await messages()).length
  await send('上下文', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text'
    && String(message.text).includes('【房间最近的对话】')
    && String(message.text).includes('codex: hello')), 'thread context reaches codex')

  // 4. 凭据：从 0600 文件读出、去掉尾换行，只注入给 codex 子进程。
  from = (await messages()).length
  await send('密钥', keyBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && message.text === `key:${fakeKey}`), 'deepseek key reaches codex')

  // 5. 顶层 error 且没有 turn.completed → failed，原因可见。
  from = (await messages()).length
  await send('错误结果', errorBot)
  await waitSince(from, list => list.some(message => message.kind === 'notice' && String(message.text).includes('codex 报告失败：fake codex: model request failed')), 'error result surfaces')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')

  // 6. 只有 error item、没有 turn.completed 就退出 → failed，原因用 item 的 message。
  from = (await messages()).length
  await send('错误项', errorItemBot)
  await waitSince(from, list => list.some(message => message.kind === 'notice' && String(message.text).includes('codex 报告失败：fake codex: tool exploded')), 'error item is a terminal failure only without turn.completed')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')

  // 7. 没有 turn.completed 就退出 → failed，原因用 stderr 尾巴。
  from = (await messages()).length
  await send('无终态', noResultBot)
  await waitSince(from, list => list.some(message => message.kind === 'notice'
    && String(message.text).includes('codex 没有给出终态就退出了')
    && String(message.text).includes('connection reset before turn.completed')), 'no-terminal stderr reaches the terminal')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')

  // 8. 时间预算：静默回合到点停，终态写清原因，进程组收干净。
  from = (await messages()).length
  await send('慢', budgetBot)
  await waitSince(from, list => list.some(message => message.kind === 'stopped'
    && String(message.text).includes('超过时间上限')
    && String(message.text).includes('1.5 秒')), 'time budget stops a silent codex turn', 100)
  assert.equal((await digestSince(from)).digest.stopReason, 'stopped')
  await waitFor(() => countFakeCodex() === 0, 'budgeted codex processes exit', 80)

  // 9. SIGKILL 整个进程组：回合 failed，不留孤儿。
  from = (await messages()).length
  await send('慢', echoBot)
  await waitFor(() => fakeProcess() !== null, 'fake codex running')
  const [pid, pgid] = fakeProcess()
  process.kill(-pgid, 'SIGKILL')
  await waitSince(from, list => list.some(message => message.kind === 'notice'
    && String(message.text).includes('codex 没有给出终态就退出了')), 'killed codex surfaces')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')
  await waitFor(() => countFakeCodex() === 0, 'no codex orphan after SIGKILL', 80)
  assert.ok(pid > 0 && pgid > 0)

  // 正常完结也不留进程。
  await waitFor(() => countFakeCodex() === 0, 'codex processes exit after turns', 80)
  console.log('base-rs codex driver: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
