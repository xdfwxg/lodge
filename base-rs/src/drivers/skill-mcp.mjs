// 给不会按需读技能的引擎（codex）用的最小 MCP 服务器：只提供一个 use_skill。
// 技能正文落在本回合临时目录里（argv[2]），系统提示只有名字和一句话。
import { createInterface } from 'node:readline'
import { readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

const SKILLS_DIR = process.argv[2] ?? ''
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`)

const tool = {
  name: 'use_skill',
  description: '按名字读某个技能的全文。系统提示里列出的技能名可以直接用。',
  inputSchema: {
    type: 'object',
    properties: { name: { type: 'string', description: '技能名，来自系统提示里的清单' } },
    required: ['name'],
    additionalProperties: false,
  },
}

const read = name => {
  if (SKILLS_DIR === '' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) return null
  const file = resolve(SKILLS_DIR, `${name}.md`)
  if (!file.startsWith(SKILLS_DIR + sep)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

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
        serverInfo: { name: 'lodge-skills', version: '0.0.1' },
      },
    })
  }
  if (method === 'notifications/initialized') return
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [tool] } })
  if (method === 'tools/call') {
    if (params?.name !== 'use_skill') {
      return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: '没有这个工具。' }], isError: true } })
    }
    const name = String(params?.arguments?.name ?? '').trim()
    const text = read(name)
    return send({
      jsonrpc: '2.0',
      id,
      result: text === null
        ? { content: [{ type: 'text', text: `没有这个技能：${name || '（空）'}` }], isError: true }
        : { content: [{ type: 'text', text }], isError: false },
    })
  }
  if (id !== undefined) send({ jsonrpc: '2.0', id, result: {} })
})
