#!/usr/bin/env node
// 测试用 pi：说同一套 RPC 帧，用来确定性地验证驱动映射（不调模型）。

import { createInterface } from 'node:readline'

const write = frame => process.stdout.write(`${JSON.stringify(frame)}\n`)
const reply = text => {
  const usage = { input: 1, output: 1, cacheRead: 0 }
  // pi 会推 UI 状态；它不是提问，驱动不能因此收掉回合。
  write({ type: 'extension_ui_request', id: 'status', method: 'setStatus', status: 'working' })
  write({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: text } })
  write({ type: 'message_end', message: { role: 'assistant', usage } })
  write({ type: 'turn_end', message: { stopReason: 'stop' } })
  write({ type: 'agent_end' })
  write({ type: 'agent_settled', aborted: false })
}

const lines = createInterface({ input: process.stdin })
lines.on('line', line => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame.type === 'prompt') {
    const text = String(frame.message ?? '')
    // 驱动会在前面加房间上下文；这一轮真正的内容在【这一轮】之后。
    const body = text.includes('【这一轮】') ? text.split('【这一轮】').pop().trim() : text
    if (body.includes('拒绝')) {
      write({ id: 'reject', type: 'response', command: 'prompt', success: false, error: 'compaction in progress' })
      process.exit(0)
    }
    if (body.includes('失败')) {
      process.stderr.write('fake pi: model request failed: connection reset\n')
      process.exit(1)
    }
    if (body.includes('权限')) {
      write({ type: 'extension_ui_request', id: 'ask-1', method: 'confirm', title: 'Allow bash?' })
      return
    }
    if (body.includes('慢')) return
    if (body.includes('上下文')) {
      reply(`context:${text}`)
      return
    }
    if (body.includes('系统')) {
      const index = process.argv.indexOf('--append-system-prompt')
      reply(`system:${index >= 0 ? process.argv[index + 1] : ''}`)
      return
    }
    reply(`fake pi: ${body}`)
    return
  }
  if (frame.type === 'extension_ui_response') {
    reply('已收到回答')
  }
})
