#!/usr/bin/env node
// 测试用：像 pi 一样应答，但从不写扩展标记（模拟“声称支持 -e、实际没加载扩展”的运行时）。
// 启动自检能过（-e 在 --help 里），所以走到回合里才由标记兜底——这正是要验的那条第二道防线。
if (process.argv.slice(2).includes('--help')) {
  process.stdout.write('usage: pi [options]\n  -e, --extension <file>  load an extension\n')
  process.exit(0)
}
import { createInterface } from 'node:readline'
const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const reply = text => {
  write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
  write({ type: 'message_end', message: { role: 'assistant', usage: { input: 1, output: 1, cacheRead: 0 } } })
  write({ type: 'turn_end', message: { stopReason: 'stop' } })
  write({ type: 'agent_end' })
  write({ type: 'agent_settled', aborted: false })
}
const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  let frame
  try { frame = JSON.parse(line) } catch { return }
  if (frame?.type === 'prompt') reply('stubborn pi: 你好')
})
