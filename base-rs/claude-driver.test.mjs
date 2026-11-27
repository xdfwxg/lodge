// claude 驱动映射：用 fake-claude 说同一套 stream-json 帧，确定性地验证终态、用量、失败、预算与进程组。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakeClaude = join(dir, process.platform === 'win32' ? 'fake-claude.cmd' : 'fake-claude.mjs')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19900 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-claude-'))
chmodSync(fakeClaude, 0o755)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 200) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const countFakeClaude = () => {
  try {
    return execFileSync('pgrep', ['-f', fakeClaude], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .length
  } catch (error) {
    return error?.status === 1 ? 0 : 0
  }
}

// 找真正跑 fake-claude 的进程（排除外层的 --supervise 看门人），返回 [pid, pgid]。
const fakeProcess = () => {
  try {
    const rows = execFileSync('ps', ['-axo', 'pid=,pgid=,command='], { encoding: 'utf8' })
      .split('\n')
      .filter(line => line.includes(fakeClaude) && !line.includes('--supervise'))
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
      LODGE_CLAUDE_BIN: fakeClaude,
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

  // 发现：有二进制就 available，driverKind 是 claude，模型列表留空让 CLI 用自己配置。
  const instance = (await client.instances()).instances.find(item => item.instanceId === 'claude')
  assert.ok(instance, 'claude is discovered')
  assert.equal(instance.snapshot.state, 'available')
  assert.equal(instance.driverKind, 'claude')
  assert.deepEqual(instance.models, { default: '', options: [] })
  assert.equal(instance.capabilities?.approvalReview, false, 'v1 has no approval cards')
  assert.equal(instance.capabilities?.streaming, false, 'v1 has no content deltas')

  const baseSettings = { lease: { read: [], write: [], exec: false, network: [] } }
  const echoBot = (await client.createBot({
    name: 'claude 聊天成员',
    modelSelection: { instanceId: 'claude', model: '' },
    settings: { ...baseSettings, soul: '你是小陈，说话简短。' },
  })).bot
  const errorBot = (await client.createBot({
    name: '错误成员',
    modelSelection: { instanceId: 'claude', model: '' },
    settings: baseSettings,
  })).bot
  const noResultBot = (await client.createBot({
    name: '无终态成员',
    modelSelection: { instanceId: 'claude', model: '' },
    settings: baseSettings,
  })).bot
  const budgetBot = (await client.createBot({
    name: '预算成员',
    modelSelection: { instanceId: 'claude', model: '' },
    settings: { ...baseSettings, budget: { maxMs: 1500 } },
  })).bot
  const modelBot = (await client.createBot({
    name: '指定模型成员',
    modelSelection: { instanceId: 'claude', model: 'fake-model' },
    settings: baseSettings,
  })).bot
  // 技能正文不许进提示词：清单走 system prompt，正文由 use_skill 的 MCP 服务器现取。
  await client.importLibrarySkill('---\nname: lodge-build\n---\n# Build\n先跑最小切片。正文标记 SKILL-BODY-5150')
  await client.approveLibrarySkill('lodge-build')
  const skillBot = (await client.createBot({
    name: '技能成员',
    modelSelection: { instanceId: 'claude', model: '' },
    settings: baseSettings,
  })).bot
  await client.setBotSkills(skillBot.id, ['lodge-build'])

  const group = (await client.createGroup({
    name: 'claude 契约房',
    memberIds: [echoBot.id, errorBot.id, noResultBot.id, budgetBot.id, modelBot.id, skillBot.id],
  })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: 'claude',
    defaultResponder: { kind: 'member', botId: echoBot.id },
    followMentions: false,
  })

  const messages = async () => (await client.threadMessages(group.threadId)).messages
  const send = (text, bot) => client.sendGroupMessage(group.id, text, { mentions: [bot.id] })
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

  // 1. 普通回合：assistant 文本累加，usage 从 result 帧取。
  let from = (await messages()).length
  await send('hello', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && message.text === 'claude: hello'), 'claude text')
  await waitSince(from, list => list.some(message => message.kind === 'digest'), 'claude digest')
  const completed = await digestSince(from)
  assert.equal(completed.digest.stopReason, 'completed')
  assert.deepEqual(completed.digest.usage, { input: 11, output: 7, cacheRead: 5 })

  // 2. soul 走 --append-system-prompt；上下文每轮随提示词带上。
  from = (await messages()).length
  await send('系统', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && message.text === 'system:你是小陈，说话简短。'), 'soul reaches claude')

  from = (await messages()).length
  await send('上下文', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text'
    && String(message.text).includes('【房间最近的对话】')
    && String(message.text).includes('claude: hello')), 'thread context reaches claude')

  // 3. 命令形状：默认不传 --model；声明了模型才传；--tools 必须是空串。
  from = (await messages()).length
  await send('参数', echoBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).startsWith('args:')), 'default args')
  const defaultArgs = JSON.parse(String((await messages()).slice(from).find(message => String(message.text ?? '').startsWith('args:')).text).slice(5))
  assert.equal(defaultArgs.model, null, 'empty model means no --model')
  assert.equal(defaultArgs.tools, '', '--tools "" disables every tool')
  assert.equal(defaultArgs.verbose, true)
  assert.equal(defaultArgs.output, 'stream-json')
  assert.equal(defaultArgs.mcp, null, 'no skills means no MCP config')
  assert.equal(defaultArgs.strictMcp, false)
  assert.equal(defaultArgs.allowed, null)

  // 3b. 有技能时：只挂一个 use_skill 的 MCP 服务器，正文不进提示词。
  from = (await messages()).length
  await send('参数', skillBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).startsWith('args:')), 'skill args')
  const skillArgs = JSON.parse(String((await messages()).slice(from).find(message => String(message.text ?? '').startsWith('args:')).text).slice(5))
  assert.match(String(skillArgs.mcp), /^--mcp-config=/, 'skills bring one MCP config')
  assert.equal(skillArgs.strictMcp, true, 'only our MCP config is read')
  assert.equal(skillArgs.allowed, '--allowedTools=mcp__lodge_skills__use_skill', 'one tool is allowed')

  from = (await messages()).length
  await send('系统', skillBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).startsWith('system:')), 'skill catalog')
  const skillSystem = String((await messages()).slice(from).find(message => String(message.text ?? '').startsWith('system:')).text).slice(7)
  assert.match(skillSystem, /可用的技能/, 'the catalog is listed')
  assert.match(skillSystem, /lodge-build/, 'the skill name is listed')
  assert.ok(!skillSystem.includes('SKILL-BODY-5150'), 'the body never enters the prompt')

  from = (await messages()).length
  await send('参数', modelBot)
  await waitSince(from, list => list.some(message => message.kind === 'text' && String(message.text).includes('"model":"fake-model"')), 'explicit model reaches claude')

  // 4. result.is_error → failed，原因可见。
  from = (await messages()).length
  await send('错误结果', errorBot)
  await waitSince(from, list => list.some(message => message.kind === 'notice' && String(message.text).includes('fake claude: model request failed')), 'error result surfaces')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')

  // 5. 没有 result 就退出 → failed，原因用 stderr 尾巴。
  from = (await messages()).length
  await send('无终态', noResultBot)
  await waitSince(from, list => list.some(message => message.kind === 'notice'
    && String(message.text).includes('claude 没有给出终态就退出了')
    && String(message.text).includes('connection reset before result')), 'no-result stderr reaches the terminal')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')

  // 6. 时间预算：静默回合到点停，终态写清原因，进程组收干净。
  from = (await messages()).length
  await send('慢', budgetBot)
  await waitSince(from, list => list.some(message => message.kind === 'stopped'
    && String(message.text).includes('超过时间上限')
    && String(message.text).includes('1.5 秒')), 'time budget stops a silent claude turn', 100)
  assert.equal((await digestSince(from)).digest.stopReason, 'stopped')
  await waitFor(() => countFakeClaude() === 0, 'budgeted claude processes exit', 80)

  // 7. SIGKILL 整个进程组：回合 failed，不留孤儿。
  from = (await messages()).length
  await send('慢', echoBot)
  await waitFor(() => fakeProcess() !== null, 'fake claude running')
  const [pid, pgid] = fakeProcess()
  process.kill(-pgid, 'SIGKILL')
  await waitSince(from, list => list.some(message => message.kind === 'notice'
    && String(message.text).includes('claude 没有给出终态就退出了')), 'killed claude surfaces')
  assert.equal((await digestSince(from)).digest.stopReason, 'failed')
  await waitFor(() => countFakeClaude() === 0, 'no claude orphan after SIGKILL', 80)
  assert.ok(pid > 0 && pgid > 0)

  // 正常完结也不留进程。
  await waitFor(() => countFakeClaude() === 0, 'claude processes exit after turns', 80)
  console.log('base-rs claude driver: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
