#!/usr/bin/env node
// 测试用 codex：说同一套 `codex exec --json` 事件，用来确定性地验证驱动映射（不调模型）。
// 模式按提示词关键字分支，也可以用 CODEX_FAKE_MODE 直接指定。
import { readdirSync } from 'node:fs'
import { join } from 'node:path'

// 技能按目录发现：这里只回答“这个回合的 CODEX_HOME 里有没有 lodge-build 技能”。
const skillFilePresent = () => {
  try { return readdirSync(join(process.env.CODEX_HOME ?? '', 'skills', 'lodge-build')).includes('SKILL.md') } catch { return false }
}

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write('usage: codex exec --json --skip-git-repo-check --sandbox <mode> -c key=value -m <model> -- <prompt>\n')
  process.exit(0)
}
if (argv.includes('--version') || argv.includes('-V')) {
  process.stdout.write('codex-cli 0.0.0-fake\n')
  process.exit(0)
}

const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const mode = process.env.CODEX_FAKE_MODE ?? ''
const argValue = name => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
// codex 的 -c 是 key=value，value 按 TOML 解析；这里只剥掉包在外面的引号。
const configValue = key => {
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== '-c') continue
    const setting = argv[index + 1] ?? ''
    const cut = setting.indexOf('=')
    if (cut < 0 || setting.slice(0, cut) !== key) continue
    return setting.slice(cut + 1).replace(/^"|"$/g, '')
  }
  return undefined
}

const prompt = argv[argv.length - 1] ?? ''
// 驱动会在前面加角色与房间上下文；这一轮真正的内容在【这一轮】之后。
const body = prompt.includes('【这一轮】') ? prompt.split('【这一轮】').pop().trim() : prompt

const started = () => {
  write({ type: 'thread.started', thread_id: 'fake-codex-thread' })
  write({ type: 'turn.started' })
}
const usage = {
  input_tokens: 11,
  cached_input_tokens: 5,
  cache_write_input_tokens: 0,
  output_tokens: 7,
  reasoning_output_tokens: 0,
}
const reply = text => {
  started()
  // 真实 codex 每次都会发一条 item.type=error 的告警；它不该把回合判死。
  write({
    type: 'item.completed',
    item: {
      id: 'item_warning',
      type: 'error',
      message: 'Model metadata for `deepseek-chat` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.',
    },
  })
  write({
    type: 'item.completed',
    item: { id: 'item_reasoning', type: 'reasoning', text: '这段中间推理不该进房间' },
  })
  // 正文分两条 agent_message，验证驱动把多条累加（不自创增量协议）。
  write({
    type: 'item.completed',
    item: { id: 'item_1', type: 'agent_message', text: text.slice(0, 7) },
  })
  write({
    type: 'item.completed',
    item: { id: 'item_2', type: 'agent_message', text: text.slice(7) },
  })
  write({ type: 'turn.completed', usage })
}

// 真实 codex 会把 stdin 读到 EOF 才开始；fake 也等 EOF，契约测试才能抓住
// “stdin 被接成常开管道”这类回归（看门人包装层默认是 piped）。
// 5 秒还没 EOF 就明确失败，别让测试无限挂着。
let begun = false
const main = () => {
  if (begun) return
  begun = true
  run()
}
const run = () => {
  if (mode === 'slow' || body.includes('慢') || body.includes('被杀')) {
    // 预算或外部 SIGKILL 收口；不给 turn.completed，句柄由驱动/看门人收掉。
    started()
    setInterval(() => {}, 1000)
  } else if (mode === 'error' || body.includes('错误结果')) {
    started()
    write({ type: 'error', message: 'fake codex: model request failed' })
    process.stderr.write('fake codex: model request failed\n')
    setTimeout(() => process.exit(1), 120)
  } else if (mode === 'error-item' || body.includes('错误项')) {
    started()
    write({
      type: 'item.completed',
      item: { id: 'item_error', type: 'error', message: 'fake codex: tool exploded' },
    })
    process.stderr.write('fake codex: exiting after an error item\n')
    setTimeout(() => process.exit(1), 120)
  } else if (mode === 'no-turn-completed' || body.includes('无终态')) {
    started()
    write({
      type: 'item.completed',
      item: { id: 'item_1', type: 'agent_message', text: '半句' },
    })
    process.stderr.write('fake codex: connection reset before turn.completed\n')
    // 让驱动的 stderr 读取任务先拿到尾巴，再退出。
    setTimeout(() => process.exit(1), 120)
  } else if (body.includes('参数')) {
    reply(`args:${JSON.stringify({
      model: argValue('-m') ?? null,
      sandbox: argValue('--sandbox') ?? null,
      json: argv.includes('--json'),
      skipGitRepoCheck: argv.includes('--skip-git-repo-check'),
      provider: configValue('model_provider') ?? null,
      providerName: configValue('model_providers.deepseek.name') ?? null,
      providerBaseUrl: configValue('model_providers.deepseek.base_url') ?? null,
      providerEnvKey: configValue('model_providers.deepseek.env_key') ?? null,
      providerWireApi: configValue('model_providers.deepseek.wire_api') ?? null,
      codexHome: process.env.CODEX_HOME ?? null,
      skillFile: skillFilePresent(),
    })}`)
  } else if (body.includes('系统')) {
    reply(`system:${prompt}`)
  } else if (body.includes('上下文')) {
    reply(`context:${prompt}`)
  } else if (body.includes('密钥')) {
    reply(`key:${process.env.DEEPSEEK_API_KEY ?? ''}`)
  } else {
    reply(`codex: ${body}`)
  }
}

process.stdin.resume()
process.stdin.once('end', main)
process.stdin.once('close', main)
process.stdin.once('error', main)
setTimeout(() => {
  if (!begun) {
    process.stderr.write('fake codex: stdin was never closed\n')
    process.exit(2)
  }
}, 5000)
