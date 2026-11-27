// 写端点的行为契约：写进去什么，读回来就是什么。
// 白名单只证明端点存在；这里证明设置真的落到了服务读取的那一份。
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const port = 18400 + Math.floor(Math.random() * 400)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-behavior-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db'), '--fake'],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)

const waitFor = async (check, label, tries = 100) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return
    await sleep(100)
  }
  throw new Error(`timeout: ${label}`)
}

const client = createBaseClient({ baseUrl })

try {
  await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')

  // 1. 创建时声明的 settings 原样读回。
  const created = await client.createBot({
    name: '行为成员',
    modelSelection: { instanceId: 'pi', model: '' },
    settings: { soul: '你是执行官', approvalMode: 'auto', nativeTools: ['read', 'bash'], budget: { toolCalls: 50, maxMs: 60000 } },
  })
  let bootstrap = await client.bootstrap()
  let bot = bootstrap.bots.find(item => item.id === created.bot.id)
  assert.equal(bot.settings.soul, '你是执行官')
  assert.equal(bot.settings.approvalMode, 'auto')
  assert.deepEqual(bot.settings.nativeTools, ['read', 'bash'])
  assert.deepEqual(bot.settings.budget, { toolCalls: 50, maxMs: 60000 })

  // 2. PATCH 的设置字段必须落进 settings（不是顶层的装饰）。
  await client.patchBot(bot.id, {
    soul: '你是新的执行官',
    approvalMode: 'ask',
    mcpServers: ['demo'],
    autoMcpServers: ['demo'],
    network: 'none',
    profile: 'strict',
    nativeTools: ['read'],
    budget: { toolCalls: 10, maxMs: 5000 },
  })
  bootstrap = await client.bootstrap()
  bot = bootstrap.bots.find(item => item.id === created.bot.id)
  assert.equal(bot.settings.soul, '你是新的执行官')
  assert.equal(bot.settings.approvalMode, 'ask')
  assert.deepEqual(bot.settings.mcpServers, ['demo'])
  assert.deepEqual(bot.settings.autoMcpServers, ['demo'])
  assert.equal(bot.settings.network, 'none')
  assert.equal(bot.settings.profile, 'strict')
  assert.deepEqual(bot.settings.nativeTools, ['read'])
  assert.deepEqual(bot.settings.budget, { toolCalls: 10, maxMs: 5000 })
  assert.equal(bot.soul, undefined, 'settings do not leak to the top level')

  // 3. 身份和模型选择仍然在顶层，并且不被设置 patch 弄坏。
  await client.patchBot(bot.id, { name: '改了名', modelSelection: { instanceId: 'pi', model: 'm2' } })
  bootstrap = await client.bootstrap()
  bot = bootstrap.bots.find(item => item.id === created.bot.id)
  assert.equal(bot.name, '改了名')
  assert.deepEqual(bot.modelSelection, { instanceId: 'pi', model: 'm2' })
  assert.equal(bot.settings.soul, '你是新的执行官', 'a name patch does not wipe settings')

  // 4. MCP 服务器的 PATCH 只改传进来的字段，启动参数不丢。
  await client.createMcpServer({ name: 'demo', command: 'node', args: ['-e', 'x'], enabled: true })
  await client.patchMcpServer('demo', { enabled: false })
  let servers = (await client.mcpServers()).servers
  let server = servers.find(item => item.name === 'demo')
  assert.equal(server.enabled, false)
  assert.equal(server.command, 'node')
  assert.deepEqual(server.args, ['-e', 'x'])
  await client.patchMcpServer('demo', { enabled: true })
  servers = (await client.mcpServers()).servers
  assert.equal(servers.find(item => item.name === 'demo').enabled, true)

  // 5. settings 的每一个键都写进去、读回来：这些就是服务端真正读的那份。
  await client.patchBot(bot.id, {
    cwd: '/tmp/worker',
    network: 'proxy',
    profile: 'standard',
    limits: { fileBytes: 1048576, processes: 7 },
    toolScope: { deny: ['mcp:agents:*'] },
    lease: { read: ['/tmp/worker'], write: [], exec: false, network: [] },
  })
  bootstrap = await client.bootstrap()
  bot = bootstrap.bots.find(item => item.id === created.bot.id)
  assert.equal(bot.settings.cwd, '/tmp/worker')
  assert.equal(bot.settings.network, 'proxy')
  assert.equal(bot.settings.profile, 'standard')
  assert.deepEqual(bot.settings.limits, { fileBytes: 1048576, processes: 7 })
  assert.deepEqual(bot.settings.toolScope, { deny: ['mcp:agents:*'] })
  assert.deepEqual(bot.settings.lease, { read: ['/tmp/worker'], write: [], exec: false, network: [] })
  // 只改一个字段，别的设置原样保留。
  await client.patchBot(bot.id, { network: 'none' })
  bootstrap = await client.bootstrap()
  bot = bootstrap.bots.find(item => item.id === created.bot.id)
  assert.equal(bot.settings.network, 'none')
  assert.equal(bot.settings.cwd, '/tmp/worker')
  assert.deepEqual(bot.settings.budget, { toolCalls: 10, maxMs: 5000 })

  // 6. 技能库：导入 → 列表 → 启用 → 分配给成员 → 成员读回。
  const skillText = '---\nname: behavior-skill\ndescription: 测试用\n---\n# Skill\n正文\n'
  const imported = await client.importLibrarySkill(skillText)
  assert.equal(imported.name, 'behavior-skill')
  let library = (await client.skillsLibrary()).skills
  assert.equal(library.find(item => item.name === 'behavior-skill').enabled, false)
  await client.approveLibrarySkill('behavior-skill')
  library = (await client.skillsLibrary()).skills
  assert.equal(library.find(item => item.name === 'behavior-skill').enabled, true)
  // 要换正文就删掉旧的再导入：同名不覆盖，也不留两份。
  await client.deleteLibrarySkill('behavior-skill')
  library = (await client.skillsLibrary()).skills
  assert.equal(library.some(item => item.name === 'behavior-skill'), false)
  const reimported = await client.importLibrarySkill(skillText.replace('正文', '新正文'))
  assert.equal(reimported.created, true)
  assert.equal((await client.readLibrarySkill('behavior-skill')).text.includes('新正文'), true)
  await assert.rejects(() => client.deleteLibrarySkill('behavior-skill-missing'), /404/)
  await client.setBotSkills(bot.id, ['behavior-skill'])
  bootstrap = await client.bootstrap()
  bot = bootstrap.bots.find(item => item.id === created.bot.id)
  assert.deepEqual(bot.assignedSkills, ['behavior-skill'])
  await client.setBotSkills(bot.id, [])
  bootstrap = await client.bootstrap()
  assert.deepEqual(bootstrap.bots.find(item => item.id === created.bot.id).assignedSkills, [])

  // 7. MCP 定义：创建 → PUT 覆盖 → PATCH 保留其余 → 删除后列表没有。
  await client.updateMcpServer('demo', { name: 'demo', command: 'node', args: ['x'], enabled: true })
  server = (await client.mcpServers()).servers.find(item => item.name === 'demo')
  assert.equal(server.command, 'node')
  assert.deepEqual(server.args, ['x'])
  await client.deleteMcpServer('demo')
  assert.equal((await client.mcpServers()).servers.some(item => item.name === 'demo'), false)

  // 8. 群成员 PATCH 读回一致。
  const group = await client.createGroup({ name: '行为群', memberIds: [bot.id] })
  await client.patchGroup(group.group.id, { memberIds: [] })
  bootstrap = await client.bootstrap()
  const stored = bootstrap.groups.find(item => item.id === group.group.id)
  assert.deepEqual(stored.memberIds, [])

  // 9. 群的 setup / tasks / holds 都落回同一个群记录。
  await client.setupGroup(group.group.id, { bulletin: '目标：验证行为契约' })
  await client.patchGroupTask(group.group.id, stored.threadId, { tasks: [{ id: 't1', text: '做一件事' }] })
  await client.setGroupHold(group.group.id, bot.id, true)
  bootstrap = await client.bootstrap()
  const after = bootstrap.groups.find(item => item.id === group.group.id)
  assert.equal(after.setup, true)
  assert.equal(after.bulletin, '目标：验证行为契约')
  assert.deepEqual(after.tasks, [{ id: 't1', text: '做一件事' }])
  assert.equal(after.holds[bot.id], true)
  await client.setGroupHold(group.group.id, bot.id, false)
  bootstrap = await client.bootstrap()
  assert.equal(bootstrap.groups.find(item => item.id === group.group.id).holds[bot.id], false)

  // 10. 删除是真的删：成员和群读回都没有。
  const doomed = await client.createBot({ name: '临时成员', modelSelection: { instanceId: 'pi', model: '' }, settings: {} })
  await client.deleteBot(doomed.bot.id)
  assert.equal((await client.bootstrap()).bots.some(item => item.id === doomed.bot.id), false)
  await client.deleteGroup(group.group.id)
  assert.equal((await client.bootstrap()).groups.some(item => item.id === group.group.id), false)

  // 11. 附件：上传的字节按名字读回来（图片接口只收图片，文本走 /api/files）。
  const uploaded = await client.uploadFile(Buffer.from('hello attachment'), 'note.txt', 'text/plain')
  assert.equal(uploaded.name, 'note.txt')
  const back = await client.attachment(uploaded.path)
  assert.equal(back.mime, 'text/plain')
  assert.equal(back.bytes.toString(), 'hello attachment')

  console.log('base-rs behavior: ok')
} finally {
  child.kill('SIGTERM')
  try { rmSync(dataDir, { recursive: true, force: true }) } catch {}
}
