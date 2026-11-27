// 会吐大结果的 stdio MCP 服务器：用来验证基座网关的裁剪、落盘和工具封顶。
import { createInterface } from 'node:readline'

const BIG = 'x'.repeat(20_000)
const NOTE = '落盘检查用：0123456789'.repeat(200)
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)

createInterface({ input: process.stdin }).on('line', line => {
  let message = null
  try { message = JSON.parse(line) } catch { return }
  const { id, method, params } = message
  if (method === 'initialize') {
    return send({
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'big', version: '0.0.1' },
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
          name: 'big',
          description: `${'很长的描述。'.repeat(200)}`,
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }, {
          name: 'note',
          description: '吐一段可检索的长文本。',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }, {
          name: 'small',
          description: 'ok',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        }],
      },
    })
  }
  if (method === 'tools/call') {
    const name = params?.name
    if (name === 'big') {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: BIG }], isError: false } })
    }
    if (name === 'note') {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: NOTE }], isError: false } })
    }
    if (name === 'small') {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'ok' }], isError: false } })
    }
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: `unknown ${name}` }], isError: true } })
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} })
})
