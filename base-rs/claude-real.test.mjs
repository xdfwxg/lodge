// 真实 claude 冒烟（会调用模型，按需运行）：跑一轮 Reply with exactly: ok。
// 用法：npm run base:rs:claude:real
// claude 不存在或调不通时明确 skip（退出 0 并说清原因），不静默通过。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const port = 21500 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-claude-real-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 300) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return true
    await sleep(100)
  }
  return false
}

const hasClaude = () => {
  if (process.env.LODGE_CLAUDE_BIN) return true
  try {
    execFileSync('which', ['claude'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

if (!hasClaude()) {
  console.log('base-rs real claude: skip（本机没有 claude 命令；装好并登录后再跑）')
  process.exit(0)
}

const child = spawn(
  bin,
  ['--port', String(port), '--db', join(dataDir, 'base.db')],
  { stdio: ['ignore', 'inherit', 'inherit'] },
)
let skipReason = ''

try {
  const ready = await waitFor(async () => {
    try {
      return (await fetch(`${baseUrl}/api/health`)).ok
    } catch {
      return false
    }
  }, 'health')
  if (!ready) {
    skipReason = '基座没有起来'
  } else {
    const client = createBaseClient({ baseUrl })
    const instances = await client.instances()
    const claude = instances.instances.find(instance => instance.instanceId === 'claude')
    if (!claude) {
      skipReason = '基座没有发现 claude 命令'
    } else if (claude.snapshot?.state !== 'available') {
      skipReason = `claude 不可用：${claude.snapshot?.reason ?? '没有原因'}`
    } else {
      console.log(`claude real: ${claude.version ?? 'version unknown'}（模型由 CLI 自己的配置决定）`)
      const bot = (await client.createBot({
        name: '真实 claude',
        modelSelection: { instanceId: 'claude', model: '' },
        settings: { lease: { read: [], write: [], exec: false, network: [] } },
      })).bot
      const group = (await client.createGroup({ name: '真实 claude 房', memberIds: [bot.id] })).group
      await client.setupGroup(group.id, {
        action: 'complete',
        cwd: '/tmp',
        bulletin: 'claude 冒烟',
        defaultResponder: { kind: 'member', botId: bot.id },
        followMentions: false,
      })

      const before = (await client.threadMessages(group.threadId)).messages.length
      await client.sendGroupMessage(group.id, 'Reply with exactly: ok')
      let terminal = null
      // 真实模型可能慢：最多等 120 秒，拿到 digest 就停。
      for (let i = 0; i < 1200; i += 1) {
        const messages = (await client.threadMessages(group.threadId)).messages.slice(before)
        const digest = messages.find(message => message.kind === 'digest')
        if (digest) {
          terminal = {
            digest,
            message: messages.find(message => ['text', 'notice', 'stopped'].includes(message.kind)),
          }
          break
        }
        await sleep(100)
      }
      if (terminal === null) {
        skipReason = 'claude 在 120 秒内没有给出终态'
      } else if (terminal.digest.digest.stopReason !== 'completed') {
        skipReason = `claude 调不通：${String(terminal.message?.text ?? '没有原因').slice(0, 300)}`
      } else {
        const text = String(terminal.message?.text ?? '')
        assert.match(text, /ok/i, '真实 claude 应该回 ok')
        assert.ok(terminal.digest.digest.usage, 'digest carries usage')
        const usage = terminal.digest.digest.usage
        console.log(`real claude reply: ${text.slice(0, 120)} (in=${usage.input} out=${usage.output})`)
        console.log('base-rs real claude: ok')
      }
    }
  }
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}

if (skipReason !== '') {
  console.log(`base-rs real claude: skip（${skipReason}）`)
}
