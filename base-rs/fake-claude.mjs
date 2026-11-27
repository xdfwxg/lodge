#!/usr/bin/env node
// 测试用 claude：说同一套 stream-json 帧，用来确定性地验证驱动映射（不调模型）。
// 模式按提示词关键字分支，也可以用 CLAUDE_FAKE_MODE 直接指定。

import { createInterface } from 'node:readline'

const argv = process.argv.slice(2)
if (argv.includes('--help') || argv.includes('-h')) {
  process.stdout.write('usage: claude -p --output-format stream-json --verbose --tools "" [--model <model>] [prompt]\n')
  process.exit(0)
}
if (argv.includes('--version') || argv.includes('-v')) {
  process.stdout.write('claude 0.0.0-fake\n')
  process.exit(0)
}

const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const mode = process.env.CLAUDE_FAKE_MODE ?? ''
const argValue = name => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : undefined
}
const prompt = argv[argv.length - 1] ?? ''
// 驱动会在前面加房间上下文；这一轮真正的内容在【这一轮】之后。
const body = prompt.includes('【这一轮】') ? prompt.split('【这一轮】').pop().trim() : prompt

const init = () => write({
  type: 'system',
  subtype: 'init',
  session_id: 'fake-claude-session',
  tools: [],
  mcp_servers: [],
  model: argValue('--model') ?? 'cli-default',
})
const usage = { input_tokens: 11, output_tokens: 7, cache_read_input_tokens: 5 }
const result = (extra = {}) => write({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: '',
  session_id: 'fake-claude-session',
  usage,
  ...extra,
})
const reply = text => {
  init()
  write({
    type: 'assistant',
    session_id: 'fake-claude-session',
    message: {
      role: 'assistant',
      content: [
        { type: 'thinking', thinking: '这段中间推理不该进房间' },
        { type: 'text', text: text.slice(0, 7) },
        { type: 'text', text: text.slice(7) },
      ],
    },
  })
  result({ result: text })
}

if (mode === 'slow' || body.includes('慢') || body.includes('被杀')) {
  // 预算或外部 SIGKILL 收口；不给 result，句柄由驱动/看门人收掉。
  init()
  setInterval(() => {}, 1000)
} else if (mode === 'error' || body.includes('错误结果')) {
  init()
  write({
    type: 'assistant',
    session_id: 'fake-claude-session',
    message: { role: 'assistant', content: [{ type: 'text', text: '半句' }] },
  })
  write({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result: 'fake claude: model request failed',
    session_id: 'fake-claude-session',
    usage,
  })
} else if (mode === 'no-result' || body.includes('无终态')) {
  init()
  write({
    type: 'assistant',
    session_id: 'fake-claude-session',
    message: { role: 'assistant', content: [{ type: 'text', text: '半句' }] },
  })
  process.stderr.write('fake claude: connection reset before result\n')
  // 让驱动的 stderr 读取任务先拿到尾巴，再退出。
  setTimeout(() => process.exit(1), 120)
} else if (body.includes('系统')) {
  reply(`system:${argValue('--append-system-prompt') ?? ''}`)
} else if (body.includes('参数')) {
  const modelIndex = argv.indexOf('--model')
  const toolsIndex = argv.indexOf('--tools')
  reply(`args:${JSON.stringify({
    model: modelIndex >= 0 ? argv[modelIndex + 1] : null,
    tools: toolsIndex >= 0 ? argv[toolsIndex + 1] : null,
    verbose: argv.includes('--verbose'),
    output: argValue('--output-format') ?? null,
    mcp: argv.find(arg => arg.startsWith('--mcp-config')) ?? null,
    strictMcp: argv.includes('--strict-mcp-config'),
    allowed: argv.find(arg => arg.startsWith('--allowedTools')) ?? null,
  })}`)
} else if (body.includes('上下文')) {
  reply(`context:${prompt}`)
} else {
  reply(`claude: ${body}`)
}

// stdin 不参与 v1：-p 是一次性调用。保留 readline 只为防父进程还开着管道。
createInterface({ input: process.stdin }).on('line', () => {})
