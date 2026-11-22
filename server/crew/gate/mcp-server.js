#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import { normalizeAskDecision } from '../../../shared/decision.js'

// 房间内置的判定工具：只接结构化字段，不碰文件、网络或外部服务。
// Lodge 从回合活动里读取工具入参，因此这里只负责校验并回执。
const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', maxLength: 200 },
    severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
    evidence: { type: 'string', maxLength: 2000 },
  },
  required: ['title'],
  additionalProperties: false,
}

// 平台给了渲染图时，验收员必须引用像素检查的数字；看不到图就如实写 seen:false。
const VISUAL_SCHEMA = {
  type: 'object',
  properties: {
    seen: { type: 'boolean' },
    colors: { type: 'integer', minimum: 0 },
    contrast: { type: 'integer', minimum: 0 },
  },
  required: ['seen'],
  additionalProperties: false,
}

export const GATE_TOOLS = Object.freeze([
  {
    name: 'submit_verdict',
    description: '提交这一步的验收判定：PASS 表示通过，REJECT 表示不通过。调用后不用再把 JSON 写进回复。',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['PASS', 'REJECT'] },
        reason: { type: 'string', maxLength: 2000 },
        findings: { type: 'array', items: FINDING_SCHEMA, maxItems: 10 },
        outsideDiff: { type: 'string', maxLength: 500 },
        actionRequired: { type: 'string', maxLength: 1000 },
        visual: VISUAL_SCHEMA,
      },
      required: ['decision', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_decision',
    description: '规划师收到验收退回时用它提交决定（返工或交给人）。判定一律先调用本工具；调用后不用再把 JSON 写进回复。',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['rework', 'human'] },
        reason: { type: 'string', maxLength: 2000 },
        actionRequired: { type: 'string', maxLength: 1000 },
      },
      required: ['decision', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_decision',
    description: '遇到会改变结果、且你无法从目标推断用户偏好的关键分叉时，用它给用户一张决策卡：2–3 条具体路径，每条写清选完会发生什么，再推荐一条。不要用聊天提问代替这张卡；不影响结果的细节自己写死继续。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', maxLength: 500 },
        options: {
          type: 'array',
          minItems: 2,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', maxLength: 40 },
              title: { type: 'string', maxLength: 80 },
              effect: { type: 'string', maxLength: 240 },
            },
            required: ['id', 'title', 'effect'],
            additionalProperties: false,
          },
        },
        recommended: { type: 'string', maxLength: 40 },
        reason: { type: 'string', maxLength: 2000 },
      },
      required: ['question', 'options', 'recommended', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_question',
    description: '缺少无法从目标、证据或仓库推断出的事实时，只问用户一个核心问题。它会让房间暂停等回答；不要用它代替决策卡，也不要在聊天里只问一句。',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', maxLength: 500 },
      },
      required: ['question'],
      additionalProperties: false,
    },
  },
  {
    name: 'rewind_stage',
    description: '把工作退回到指定步骤，后面的步骤全部重来。只有用户明确要求退回或重做前面某一步时，规划师才调用；不要让用户去找按钮。',
    inputSchema: {
      type: 'object',
      properties: {
        stage: { type: 'integer', minimum: 1, maximum: 20 },
        note: { type: 'string', maxLength: 4000 },
      },
      required: ['stage', 'note'],
      additionalProperties: false,
    },
  },
])

const reply = (id, result) => ({ jsonrpc: '2.0', id, result })
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } })
const toolFailure = (id, text) => reply(id, { content: [{ type: 'text', text }], isError: true })
const toolOk = (id, text, structuredContent) => reply(id, {
  content: [{ type: 'text', text }],
  structuredContent,
})

const verdictDecision = value => {
  const raw = String(value ?? '').trim().toUpperCase()
  if (raw === 'PASS' || raw === '通过') return 'PASS'
  if (raw === 'REJECT' || raw === '不通过') return 'REJECT'
  return null
}

const plannerDecision = value => {
  const raw = String(value ?? '').trim().toLowerCase()
  if (raw === 'rework' || raw === '返工' || raw === '重做') return 'rework'
  if (raw === 'human' || raw === 'handoff' || raw === '交给人' || raw === '人工' || raw === '转人工') return 'human'
  return null
}

const callTool = (id, params) => {
  const name = typeof params?.name === 'string' ? params.name : ''
  const args = params?.arguments ?? params?.input ?? {}
  if (name === 'ask_question') {
    const question = String(args.question ?? '').trim().slice(0, 500)
    if (question === '') return toolFailure(id, '缺少 question：请只写一个核心问题。')
    return toolOk(id, `已把问题发给用户：${question}`, { ok: true, kind: 'question', question })
  }
  const reason = String(args.reason ?? args.note ?? '').trim()
  if (reason === '') return toolFailure(id, '缺少 reason：请用一句话说明判定依据。')
  if (name === 'submit_verdict') {
    const decision = verdictDecision(args.decision)
    if (decision === null) return toolFailure(id, 'decision 只能是 PASS / REJECT（通过 / 不通过）。')
    const outsideDiff = typeof args.outsideDiff === 'string' ? args.outsideDiff.trim() : ''
    if (decision === 'PASS' && outsideDiff === '') {
      return toolFailure(id, 'PASS 要写一条 diff 之外的风险；没有就写「无」。')
    }
    const findings = Array.isArray(args.findings) ? args.findings.slice(0, 10) : []
    let visual
    if (args.visual !== undefined) {
      const raw = args.visual
      if (raw === null || typeof raw !== 'object' || typeof raw.seen !== 'boolean') {
        return toolFailure(id, 'visual 必须包含 seen（true/false）；colors、contrast 用平台给的整数。')
      }
      visual = {
        seen: raw.seen,
        ...(Number.isInteger(raw.colors) && raw.colors >= 0 ? { colors: raw.colors } : {}),
        ...(Number.isInteger(raw.contrast) && raw.contrast >= 0 ? { contrast: raw.contrast } : {}),
      }
    }
    return toolOk(id, `已收到验收判定：${decision}`, {
      ok: true,
      decision,
      reason,
      findings,
      outsideDiff,
      ...(visual === undefined ? {} : { visual }),
    })
  }
  if (name === 'submit_decision') {
    const decision = plannerDecision(args.decision)
    if (decision === null) return toolFailure(id, 'decision 只能是 rework 或 human。')
    return toolOk(id, `已收到规划决定：${decision}`, {
      ok: true,
      decision,
      reason,
      actionRequired: typeof args.actionRequired === 'string' ? args.actionRequired : '',
    })
  }
  if (name === 'ask_decision') {
    const result = normalizeAskDecision({ input: args })
    if (result.error !== undefined) return toolFailure(id, result.error)
    return toolOk(id, '决策卡已提交，等用户选择。', { ok: true, decision: result.decision })
  }
  if (name === 'rewind_stage') {
    const stage = Number(args.stage)
    if (!Number.isInteger(stage) || stage < 1) return toolFailure(id, 'stage 必须是从 1 开始的步骤号。')
    return toolOk(id, `已收到退回请求：第 ${stage} 步`, {
      ok: true,
      stage,
      note: reason,
    })
  }
  return toolFailure(id, `未知工具：${name}`)
}

export const handleMessage = message => {
  if (message === null || typeof message !== 'object' || message.jsonrpc !== '2.0') return null
  const method = typeof message.method === 'string' ? message.method : ''
  const id = message.id
  if (method === 'notifications/initialized') return null
  if (id === undefined && method.startsWith('notifications/')) return null
  if (method === 'initialize') {
    const version = typeof message.params?.protocolVersion === 'string' && message.params.protocolVersion !== ''
      ? message.params.protocolVersion
      : '2024-11-05'
    return reply(id, {
      protocolVersion: version,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'lodge-gate', version: '0.1.0' },
    })
  }
  if (method === 'ping') return reply(id, {})
  if (method === 'tools/list') return reply(id, { tools: GATE_TOOLS })
  if (method === 'tools/call') return callTool(id, message.params)
  if (method === 'resources/list') return reply(id, { resources: [] })
  if (method === 'prompts/list') return reply(id, { prompts: [] })
  if (method === 'logging/setLevel') return reply(id, {})
  return id === undefined ? null : failure(id, -32601, `Method not found: ${method}`)
}

const main = () => {
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  lines.on('line', line => {
    const text = line.trim()
    if (text === '') return
    let message
    try {
      message = JSON.parse(text)
    } catch {
      return
    }
    const response = handleMessage(message)
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`)
  })
}

const isMain = (() => {
  if (typeof process.argv[1] !== 'string' || process.argv[1] === '') return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
})()

if (isMain) main()
