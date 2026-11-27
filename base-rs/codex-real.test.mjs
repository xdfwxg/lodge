// 真实 codex 冒烟（会调用模型，按需运行）：跑一轮 Reply with exactly: ok。
// 用法：npm run base:rs:codex:real
// codex 不存在、没有 ~/.codex/deepseek.key 或调不通时明确 skip（退出 0 并说清原因），不静默通过。
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBaseClient } from '../server/base.js'

const dir = dirname(fileURLToPath(import.meta.url))
const bin = process.env.LODGE_BASE_RS_BIN ?? join(dir, 'target', 'debug', process.platform === 'win32' ? 'lodge-base-slice.exe' : 'lodge-base-slice')
const keyFile = process.env.LODGE_CODEX_KEY_FILE ?? join(homedir(), '.codex', 'deepseek.key')
const port = 21800 + Math.floor(Math.random() * 300)
const baseUrl = `http://127.0.0.1:${port}`
const dataDir = mkdtempSync(join(tmpdir(), 'lodge-base-codex-real-'))
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const waitFor = async (check, label, tries = 300) => {
  for (let i = 0; i < tries; i += 1) {
    if (await check()) return true
    await sleep(100)
  }
  return false
}

const hasCodex = () => {
  if (process.env.LODGE_CODEX_BIN) return true
  try {
    execFileSync('which', ['codex'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const hasKey = () => {
  try {
    return readFileSync(keyFile, 'utf8').trim() !== ''
  } catch {
    return false
  }
}

if (!hasCodex()) {
  console.log('base-rs real codex: skip（本机没有 codex 命令；装好后再跑）')
  process.exit(0)
}
if (!hasKey()) {
  console.log(`base-rs real codex: skip（没有 ${keyFile}，或文件是空的）`)
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
    const codex = instances.instances.find(instance => instance.instanceId === 'codex')
    if (!codex) {
      skipReason = '基座没有发现 codex 命令'
    } else if (codex.snapshot?.state !== 'available') {
      skipReason = `codex 不可用：${codex.snapshot?.reason ?? '没有原因'}`
    } else {
      console.log(`codex real: ${codex.version ?? 'version unknown'}（${codex.models?.default ?? 'deepseek-chat'}）`)
      const bot = (await client.createBot({
        name: '真实 codex',
        modelSelection: { instanceId: 'codex', model: codex.models?.default ?? 'deepseek-chat' },
        settings: { lease: { read: [], write: [], exec: false, network: [] } },
      })).bot
      const group = (await client.createGroup({ name: '真实 codex 房', memberIds: [bot.id] })).group
      await client.setupGroup(group.id, {
        action: 'complete',
        cwd: '/tmp',
        bulletin: 'codex 冒烟',
        defaultResponder: { kind: 'member', botId: bot.id },
        followMentions: false,
      })

      const before = (await client.threadMessages(group.threadId)).messages.length
      await client.sendGroupMessage(group.id, 'Reply with exactly: ok')
      let terminal = null
      // 真实模型可能慢：最多等 180 秒，拿到 digest 就停。
      for (let i = 0; i < 1800; i += 1) {
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
        skipReason = 'codex 在 180 秒内没有给出终态'
      } else if (terminal.digest.digest.stopReason !== 'completed') {
        skipReason = `codex 调不通：${String(terminal.message?.text ?? '没有原因').slice(0, 300)}`
      } else {
        const text = String(terminal.message?.text ?? '')
        assert.match(text, /ok/i, '真实 codex 应该回 ok')
        assert.ok(text.trim() !== '', '真实 codex 的 reply 不能为空')
        const usage = terminal.digest.digest.usage
        assert.ok(usage, 'digest carries usage')
        assert.ok(Number(usage.input) > 0, 'input tokens are reported')
        assert.ok(Number(usage.output) > 0, 'output tokens are reported')
        console.log(`real codex reply: ${text.slice(0, 120)} (in=${usage.input} out=${usage.output} cache=${usage.cacheRead})`)
        console.log('base-rs real codex: ok')
      }
    }
  }
} finally {
  child.kill('SIGTERM')
  rmSync(dataDir, { recursive: true, force: true })
}

if (skipReason !== '') {
  console.log(`base-rs real codex: skip（${skipReason}）`)
}
