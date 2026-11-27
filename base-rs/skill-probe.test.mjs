// 技能按需加载的真实探针：系统提示只列清单，正文由 use_skill 现取。`npm run base:rs:skill:real`。
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
const dir = dirname(fileURLToPath(import.meta.url))
import { createBaseClient } from '../server/base.js'
import { createEngine } from '../server/engine.js'

const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const port = 21000 + Math.floor(Math.random() * 200)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-skill-probe-'))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const waitFor = async (check, label, tries = 1200) => {
  for (let i = 0; i < tries; i += 1) { if (await check()) return true; await sleep(100) }
  throw new Error(`timeout: ${label}`)
}
const child = spawn(bin, ['--port', String(port), '--db', join(dataDir, 'base.db')], { stdio: ['ignore', 'ignore', 'inherit'] })
try {
  await waitFor(async () => { try { return (await fetch(`${baseUrl}/api/health`)).ok } catch { return false } }, 'health')
  const client = createBaseClient({ baseUrl })
  const engine = createEngine({ client })
  await client.importLibrarySkill('---\nname: lodge-build\n---\n# Build\n先跑最小切片。最后一行标记：SKILL-MARK-7788')
  await client.approveLibrarySkill('lodge-build')
  const bot = (await client.createBot({ name: '技能成员', modelSelection: { instanceId: 'pi', model: '' }, settings: { soul: '你是测试成员', nativeTools: ['read'] } })).bot
  await client.setBotSkills(bot.id, ['lodge-build'])
  const group = (await client.createGroup({ name: '技能房', memberIds: [bot.id] })).group
  await client.setupGroup(group.id, { action: 'complete', cwd: '/tmp', bulletin: '技能探针', defaultResponder: { kind: 'member', botId: bot.id }, followMentions: false })
  const events = []
  let connected = false
  engine.subscribe({ roomId: group.id, sessionRef: group.threadId, onEvent: e => events.push(e), onState: s => { if (s?.connected) connected = true } })
  await waitFor(() => connected, 'connected')
  await client.sendGroupMessage(group.id, '请用 use_skill 工具读取技能 lodge-build，然后只回复这句话里的标记（形如 SKILL-MARK-xxxx）。', { mentions: [bot.id] })
  await waitFor(() => events.some(e => e.type === 'message' && String(e.message?.text ?? '').includes('SKILL-MARK-7788')), 'skill body reached the model')
  console.log('skill on demand: ok（正文没有进系统提示，模型自己用 use_skill 取到）')
} finally { child.kill('SIGTERM'); await sleep(200); process.exit(0) }
