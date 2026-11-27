// pi 驱动映射：用 fake-pi 说同一套 RPC 帧，确定性地验证 delta、审批卡、中断。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'
import { createEngine } from '../server/engine.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const fakePi = join(dir, process.platform === 'win32' ? 'fake-pi.cmd' : 'fake-pi.mjs')
const port = 19500 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-pi-'))
const siblingDirPath = join(dataDir, 'sibling')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const countFakePi = () => {
  try {
    return execFileSync('pgrep', ['-f', fakePi], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .filter(Boolean)
      .length
  } catch (error) {
    return error?.status === 1 ? 0 : 0
  }
}

const waitFor = async (check, label, tries = 150) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db')],
  {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      ...process.env,
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
  const engine = createEngine({ client })
  const bot = (await client.createBot({
    name: 'pi 成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: {
      soul: '你是小林，先找漏洞，再谈信心。',
      lease: { read: [], write: [], exec: false, network: [] },
    },
  })).bot
  const group = (await client.createGroup({ name: 'pi 契约房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, {
    action: 'complete',
    cwd: '/tmp',
    bulletin: 'pi',
    defaultResponder: { kind: 'member', botId: bot.id },
    followMentions: false,
  })

  const events = []
  let connected = false
  const unsubscribe = engine.subscribe({
    roomId: group.id,
    sessionRef: group.threadId,
    onEvent: event => events.push(event),
    onState: state => { if (state.connected === true) connected = true },
  })
  await waitFor(() => connected, 'events connected')

  // 普通回合：delta + 文本 + digest。
  await client.sendGroupMessage(group.id, 'hello')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'fake pi: hello'),
    'pi text',
  )
  await waitFor(() => events.some(event => event.type === 'message' && event.message?.kind === 'turn'), 'pi digest')
  assert.ok(events.some(event => event.type === 'delta' && event.delta === 'fake pi: hello'))

  // 声明优先：`network: none` 的成员拿不到代理；没声明的成员照常走代理。
  const noNetBot = (await client.createBot({
    name: '断网成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { network: 'none' },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, noNetBot.id] })
  await client.sendGroupMessage(group.id, '网络模式', { mentions: [noNetBot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'proxy:none'),
    'a member can declare no network',
  )
  await client.sendGroupMessage(group.id, '网络模式', { mentions: [bot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'proxy:proxy'),
    'the default member keeps the proxy',
  )

  // 每轮把房间最近的对话带给 pi；不是只给它这一条提示。
  await client.sendGroupMessage(group.id, '上下文')
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('房间最近的对话')
      && String(event.message?.text ?? '').includes('fake pi: hello')),
    'thread context reaches pi',
  )

  // 成员的 soul 作为 system prompt 交给 pi，角色和语气不丢。
  await client.sendGroupMessage(group.id, '系统')
  await waitFor(
    () => events.some(event => event.type === 'message' && String(event.message?.text ?? '').includes('你是小林')),
    'member soul reaches pi',
  )

  // 工具面不藏：pi 的全部工具都看得见，成员只用房间授过权的那些（名单走扩展）。
  await client.sendGroupMessage(group.id, '工具')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'tools:none'),
    'no native tools without a declaration',
  )
  const toolBot = (await client.createBot({
    name: '工具成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { soul: '你是执行官', nativeTools: ['bash', 'read'] },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id] })
  await client.sendGroupMessage(group.id, '工具', { mentions: [toolBot.id] })
  try {
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'tools:bash,read'),
    'native tools follow the declaration',
  )
  } catch (error) {
    throw error
  }

  // 分到 bot 的技能只进清单（名字 + 一句话），正文按需读：不再整段塞进 system prompt。
  // 没有技能目录时 use_skill 不注册；这回合真挂了技能，扩展才会注册它。
  await client.importLibrarySkill('---\nname: lodge-build\n---\n# Build\n先跑最小切片。')
  await client.approveLibrarySkill('lodge-build')
  await client.setBotSkills(toolBot.id, ['lodge-build'])
  await client.sendGroupMessage(group.id, '系统', { mentions: [toolBot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('system:你是执行官')
      && String(event.message?.text ?? '').includes('lodge-build')
      && !String(event.message?.text ?? '').includes('先跑最小切片')),
    'assigned skill is listed, not pasted',
  )

  // MCP：库里有的服务器才挂；deny 选择器翻成 pi 的排除名单。
  await client.createMcpServer({ name: 'gate', command: process.execPath, args: ['-e', 'x'], enabled: true })
  const mcpBot = (await client.createBot({
    name: '挂载成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: {
      nativeTools: ['read'],
      mcpServers: ['gate'],
      toolScope: { deny: ['mcp:gate:hidden', 'native:bash'] },
    },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, mcpBot.id] })
  await client.sendGroupMessage(group.id, '挂载', { mentions: [mcpBot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('mcp:')
      && String(event.message?.text ?? '').includes('"gate"')),
    'declared MCP server reaches pi',
  )
  const mount = events.find(event => event.type === 'message'
    && String(event.message?.text ?? '').startsWith('mcp:'))
  // MCP 工具按真名声明；审批和角色规则要看到真实工具，不经过 codemode 这层壳。
  assert.match(mount.message.text, /"exposure":"direct"/)
  await client.sendGroupMessage(group.id, '工具', { mentions: [mcpBot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'tools:read,mcp__gate__*'),
    'MCP tools keep their real names',
  )
  await client.sendGroupMessage(group.id, '排除', { mentions: [mcpBot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'exclude:bash,mcp__gate__hidden'),
    'deny selectors reach pi',
  )

  // 工具活动：开始时给入参，结束时给回执；房间靠回执里的 submissionId 取完整提交。
  await client.sendGroupMessage(group.id, '活动')
  await waitFor(
    () => events.some(event => event.type === 'message'
      && event.message?.kind === 'activity'
      && event.message?.tool?.name === 'mcp__lodge_gate__submit_plan'
      && String(event.message?.tool?.output ?? '').includes('sub-1')),
    'tool activity carries the receipt',
  )
  const activity = events.find(event => event.type === 'message'
    && event.message?.kind === 'activity'
    && String(event.message?.tool?.output ?? '').includes('sub-1'))
  assert.equal(activity.message.ok, true)
  assert.match(String(activity.message.tool.input), /契约/)
  assert.equal(typeof activity.message.turnId, 'string')

  // 工作目录属于成员：同一个群里每个成员可以有自己的副本，群目录只是兜底。
  const ownDir = mkdtempSync(join(tmpdir(), 'lodge-own-cwd-'))
  const cwdBot = (await client.createBot({
    name: '目录成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { cwd: ownDir, nativeTools: [] },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, mcpBot.id, cwdBot.id] })
  await client.sendGroupMessage(group.id, '工作目录', { mentions: [cwdBot.id] })
  // macOS 的 /var 是 /private/var 的软链，进程报出来的 cwd 是解析后的路径。
  const ownReal = realpathSync(ownDir)
  await waitFor(
    () => events.some(event => event.type === 'message'
      && (event.message?.text === `cwd:${ownReal}` || event.message?.text === `cwd:${ownDir}`)),
    'member cwd wins over the group cwd',
  )

  // 读隔离：同群其他成员的副本在沙箱里连读都读不到。
  const siblingDir = siblingDirPath
  mkdirSync(siblingDir, { recursive: true })
  writeFileSync(join(siblingDir, 'secret.txt'), 'hidden')
  const siblingBot = (await client.createBot({
    name: '兄弟成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { cwd: siblingDir, nativeTools: [] },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, mcpBot.id, cwdBot.id, siblingBot.id] })
  await client.sendGroupMessage(group.id, `读兄弟:${join(siblingDir, 'secret.txt')}`, { mentions: [cwdBot.id] })
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').startsWith('sibling:denied')),
    'a sibling worktree is unreadable inside the sandbox',
  )
  // 沙箱：pi 和它的子进程只能写自己的副本和临时目录，往 HOME 写要被拒。
  await client.sendGroupMessage(group.id, '沙箱')
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').startsWith('sandbox:denied')),
    'sandbox blocks writes outside the worktree',
  )

  // 出网：沙箱只放行基座代理，代理再按白名单拒绝 example.com。
  await client.sendGroupMessage(group.id, '出网')
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').startsWith('egress:denied')),
    'egress proxy refuses hosts outside the allowlist',
  )

  // 回环不是后门：平台自己的端口不能被成员经代理或直连碰到。
  await client.sendGroupMessage(group.id, `回环:${port}`)
  await waitFor(
    () => events.some(event => event.type === 'message'
      && String(event.message?.text ?? '').startsWith('loopback:')),
    'loopback probe reports',
  )
  assert.equal(
    events.some(event => event.type === 'message'
      && String(event.message?.text ?? '') === 'loopback:leaked'),
    false,
    'a member cannot reach the platform control plane over loopback',
  )

  // 进程数：声明 4，fork 出 10 个就整组停掉，终态写清原因。
  const processBot = (await client.createBot({
    name: '进程成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { cwd: '/tmp', nativeTools: [], limits: { processes: 4 } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, processBot.id] })
  const beforeStorm = events.length
  await client.sendGroupMessage(group.id, '进程风暴', { mentions: [processBot.id] })
  await waitFor(
    () => events.slice(beforeStorm).some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('进程数到上限（4）')),
    'process count stops the fork storm',
    100,
  )

  // 预算：工具调用到上限就停，终态写清原因；不是无限刷下去。
  const budgetBot = (await client.createBot({
    name: '预算成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { nativeTools: ['read'], budget: { toolCalls: 2 } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, mcpBot.id, budgetBot.id] })
  const beforeBudget = events.length
  await client.sendGroupMessage(group.id, '工具循环', { mentions: [budgetBot.id] })
  await waitFor(
    () => events.slice(beforeBudget).some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('工具调用到上限（2 次）')),
    'tool budget stops the loop',
  )

  // 时间预算：模型不出声也要有时限，不能把回合挂到下次重启。
  const slowBot = (await client.createBot({
    name: '时间预算成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { nativeTools: ['read'], budget: { maxMs: 1500 } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, mcpBot.id, budgetBot.id, slowBot.id] })
  const beforeDeadline = events.length
  await client.sendGroupMessage(group.id, '慢', { mentions: [slowBot.id] })
  await waitFor(
    () => events.slice(beforeDeadline).some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('超过时间上限')),
    'time budget stops a silent turn',
    60,
  )

  // 一直不出字：不等墙上预算，空转窗口一到就停，并写清是“没有动静”。
  const idleBot = (await client.createBot({
    name: '沉默预算成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { nativeTools: ['read'], budget: { idleMs: 1200, maxMs: 60000 } },
  })).bot
  await client.patchGroup(group.id, { memberIds: [bot.id, toolBot.id, mcpBot.id, budgetBot.id, slowBot.id, idleBot.id] })
  const beforeIdle = events.length
  await client.sendGroupMessage(group.id, '慢', { mentions: [idleBot.id] })
  await waitFor(
    () => events.slice(beforeIdle).some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('没有动静')),
    'idle budget stops a silent model',
    60,
  )

  // 审批卡：真实工具名，回答后回合继续。
  await client.sendGroupMessage(group.id, '权限')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.card?.requestType === 'permission'),
    'pi permission card',
  )
  const cardEvent = events.find(event => event.type === 'message' && event.message?.card?.requestType === 'permission')
  assert.equal(cardEvent.message.card.tool, 'bash')
  // 命令要跟着卡进房间，审批桥靠它认出推送、安装、删除这类外部动作。
  assert.equal(cardEvent.message.card.subtitle, 'git push origin main')
  await engine.answerCard({
    sessionRef: group.threadId,
    requestId: cardEvent.message.card.requestId,
    behavior: 'allow',
  })
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === '已收到回答'),
    'pi continuation after answer',
  )
  await waitFor(
    () => events.filter(event => event.type === 'message' && event.message?.kind === 'turn').length >= 2,
    'pi digest after answer',
  )

  // 中断：终态 + 不再有正文；下一回合照常。
  const before = events.length
  await client.sendGroupMessage(group.id, '慢')
  await sleep(250)
  await engine.interruptBot(bot.id)
  await waitFor(
    () => events.slice(before).some(event => event.type === 'message' && event.message?.text === '已停下'),
    'pi interrupt terminal',
  )
  const terminal = events.findIndex(event => event.type === 'message' && event.message?.text === '已停下')
  await sleep(400)
  assert.equal(
    events.slice(terminal + 1).filter(event => event.type === 'message' && event.message?.kind === 'text').length,
    0,
    'no text after pi interrupt',
  )
  await client.sendGroupMessage(group.id, 'again')
  await waitFor(
    () => events.some(event => event.type === 'message' && event.message?.text === 'fake pi: again'),
    'pi turn after interrupt',
  )

  // 驱动失败：stderr 要进终态，不吞。
  const beforeFailure = events.length
  await client.sendGroupMessage(group.id, '失败')
  await waitFor(
    () => events.slice(beforeFailure).some(event => event.type === 'message' && /model request failed/.test(String(event.message?.text ?? ''))),
    'pi stderr reaches the terminal',
  )

  // 模型错误：pi 也走正常收尾，终态要带原因，不写成空回复完成。
  const beforeModelError = events.length
  await client.sendGroupMessage(group.id, '模型错误')
  await waitFor(
    () => events.slice(beforeModelError).some(event => event.type === 'message'
      && String(event.message?.text ?? '').includes('404: model not found')),
    'model error reaches the terminal',
  )
  const modelErrorTerminal = events.slice(beforeModelError).find(event => event.type === 'message'
    && String(event.message?.text ?? '').includes('404: model not found'))
  // 引擎把终态通知归一成一条 agent 文本；原因必须在，不能只剩空回合。
  assert.ok(modelErrorTerminal.message.turnTerminal === true || modelErrorTerminal.message.kind === 'text')

  // prompt 被拒：立刻失败，不等超时。
  const beforeReject = events.length
  await client.sendGroupMessage(group.id, '拒绝')
  await waitFor(
    () => events.slice(beforeReject).some(event => event.type === 'message' && /compaction in progress/.test(String(event.message?.text ?? ''))),
    'pi prompt rejection surfaces',
  )

  // 正常结束也要收掉驱动进程组；不能每轮留一个 pi 在后台等输入。
  await waitFor(() => countFakePi() === 0, 'pi processes exit after turns', 80)

  unsubscribe()
  console.log('base-rs pi driver: ok')
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}
