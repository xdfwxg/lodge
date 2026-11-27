// 最小的 stdio MCP 服务器：只提供一个 ping 工具，用来验证“外部工具要先问人”。
import { createInterface } from 'node:readline'

const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)

createInterface({ input: process.stdin }).on('line', line => {
  let message = null
  try { message = JSON.parse(line) } catch { return }
  const { id, method } = message
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'probe', version: '0.0.1' },
      },
    })
  }
  if (method === 'notifications/initialized') return
  if (method === 'tools/list') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        tools: [{
          name: 'ping',
          description: '返回 pong。没有任何副作用。',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }],
      },
    })
  }
  if (method === 'tools/call') {
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'pong' }] } })
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} })
})
