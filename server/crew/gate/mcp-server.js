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
    check: { type: 'string', maxLength: 300, description: '你实际跑的哪条检查或目标哪一行会因它失败；不通过时 blocker/major 必填。' },
  },
  required: ['title'],
  additionalProperties: false,
}

// 通过时必须逐条写清这条要求对应哪份亲手核对的证据；空覆盖表不算通过。
const COVERAGE_SCHEMA = {
  type: 'object',
  properties: {
    clauseId: { type: 'string', maxLength: 40, description: '契约要求的 id；契约房里必填。' },
    item: { type: 'string', maxLength: 300, description: '契约要求或本步交付物里的要求原文。' },
    evidence: { type: 'string', maxLength: 500, description: '你实际读了哪个文件、跑了哪条检查、看到什么。' },
  },
  required: ['item', 'evidence'],
  additionalProperties: false,
}

// 验收员的反例尝试：每条是一个能在复核副本里跑的检查；跑红就是找到反例。
const FALSIFY_SCHEMA = {
  type: 'object',
  properties: {
    clause: { type: 'string', maxLength: 40 },
    command: { type: 'string', maxLength: 500 },
    note: { type: 'string', maxLength: 300 },
  },
  required: ['command'],
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
    description: '提交这一步的验收判定：PASS 表示通过，REJECT 表示不通过。验收方法由你按目标决定。PASS 必须带 coverage，逐条写清目标或交付物里的要求和你实际核对的证据；不通过至少要有一条带 check 的 blocker/major（你实际跑的哪条检查或目标哪一行会因它失败）；只有 minor 的问题请判通过。调用后不用再把 JSON 写进回复。',
    inputSchema: {
      type: 'object',
      properties: {
        decision: { type: 'string', enum: ['PASS', 'REJECT'] },
        reason: { type: 'string', maxLength: 2000 },
        findings: { type: 'array', items: FINDING_SCHEMA, maxItems: 10 },
        outsideDiff: { type: 'string', maxLength: 500 },
        coverage: {
          type: 'array',
          maxItems: 12,
          items: COVERAGE_SCHEMA,
          description: 'PASS 必填：逐条列出目标/交付物里的要求，以及你实际核对过的文件、检查或输出。',
        },
        falsify: {
          type: 'array',
          maxItems: 3,
          items: FALSIFY_SCHEMA,
          description: 'PASS 必填：至少一次反例尝试；command 会在复核副本里执行，跑红就说明找到了反例。',
        },
        protectedFiles: {
          type: 'array',
          maxItems: 20,
          items: { type: 'string', maxLength: 200 },
          description: '这次改动里包含的受保护文件（锁文件、包清单、CI/配置、.env）；PASS 时必须逐条列出并确认，否则判定无效。',
        },
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
        options: {
          type: 'array',
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', maxLength: 40 },
              title: { type: 'string', maxLength: 120 },
              detail: { type: 'string', maxLength: 300 },
              action: { type: 'string', enum: ['accept', 'rework'] },
            },
            required: ['title', 'action'],
            additionalProperties: false,
          },
        },
      },
      required: ['decision', 'reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'submit_plan',
    description: '提交这一轮的目标契约、方案和队伍：契约写清可观察结果、边界、非目标和假设；每个阶段写清交付物、工作包、执行官与验收员（含 engine/model）。不写验收命令；验收方法由验收员按目标决定。调用后不用再把 JSON 写进回复；平台会校验并开通成员。',
    inputSchema: {
      type: 'object',
      properties: {
        why: { type: 'string', maxLength: 1000 },
        assumptions: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 300 } },
        notDoing: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 300 } },
        contract: {
          type: 'object',
          properties: {
            outcomes: {
              type: 'array',
              minItems: 1,
              maxItems: 6,
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', maxLength: 40 },
                  statement: { type: 'string', maxLength: 300 },
                  observable: { type: 'string', maxLength: 300 },
                },
                required: ['statement', 'observable'],
                additionalProperties: false,
              },
            },
            boundaries: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 300 } },
            nonGoals: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 300 } },
            assumptions: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 300 } },
          },
          required: ['outcomes'],
          additionalProperties: false,
        },
        plan: {
          type: 'object',
          properties: {
            stages: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', maxLength: 80 },
                  deliverable: { type: 'string', maxLength: 500 },
                  clauseIds: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'string', maxLength: 40 } },
                  behavior: { type: 'string', enum: ['change', 'preserve'] },
                  packages: {
                    type: 'array',
                    maxItems: 4,
                    items: {
                      type: 'object',
                      properties: {
                        title: { type: 'string', maxLength: 80 },
                        files: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', maxLength: 200 } },
                      },
                      required: ['title', 'files'],
                      additionalProperties: false,
                    },
                  },
                },
                required: ['title', 'deliverable', 'clauseIds'],
                additionalProperties: false,
              },
            },
          },
          required: ['stages'],
          additionalProperties: false,
        },
        crew: {
          type: 'object',
          properties: {
            executors: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 32 },
                  engine: { type: 'string', maxLength: 80 },
                  model: { type: 'string', maxLength: 160 },
                },
                required: ['engine', 'model'],
                additionalProperties: false,
              },
            },
            verifiers: {
              type: 'array',
              minItems: 1,
              maxItems: 3,
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', maxLength: 32 },
                  engine: { type: 'string', maxLength: 80 },
                  model: { type: 'string', maxLength: 160 },
                },
                required: ['engine', 'model'],
                additionalProperties: false,
              },
            },
          },
          required: ['executors', 'verifiers'],
          additionalProperties: false,
        },
      },
      required: ['contract', 'plan', 'crew'],
      additionalProperties: false,
    },
  },
  {
    name: 'adjust_member_model',
    description: '给房间里的某位成员换模型：只换 engine/model，不改成员、不改提示词。用于登录失效、额度用完或选错模型。',
    inputSchema: {
      type: 'object',
      properties: {
        member: { type: 'string', maxLength: 64 },
        engine: { type: 'string', maxLength: 80 },
        model: { type: 'string', maxLength: 160 },
        why: { type: 'string', maxLength: 300 },
      },
      required: ['member', 'engine', 'model'],
      additionalProperties: false,
    },
  },
  {
    name: 'ask_decision',
    description: '遇到会改变结果、且你无法从目标推断用户偏好的关键分叉时，用它给用户一张决策卡：2–3 条具体路径，每条写清选完会发生什么，再推荐一条。这是建议：由人做选择，暂停、恢复和能不能现在出卡由系统决定。不要用聊天提问代替这张卡；不影响结果的细节自己写死继续。',
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
  {
    name: 'stop_round',
    description: '用户说停、不想继续，或你判断这一轮不值得再往下做时，用它建议停下并写清理由；系统会在没有进行中的执行和复核时停住，不打断正在跑的回合。停完只回一句建议已提交，不派活、不 @ 任何人。',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', maxLength: 2000 },
      },
      required: ['reason'],
      additionalProperties: false,
    },
  },
  {
    name: 'resume_round',
    description: '房间的这一轮已经停下、而用户的意思是接着做时，用它把同一轮接回来继续；只接回停下的这一轮，不改目标，也不开新一轮。',
    inputSchema: {
      type: 'object',
      properties: {},
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
  // 继续不需要理由：用户说一句「接着做」就够了。
  if (name === 'adjust_member_model') {
    const member = String(args.member ?? '').trim()
    const engineId = String(args.engine ?? '').trim()
    const model = String(args.model ?? '').trim()
    if (member === '' || engineId === '' || model === '') return toolFailure(id, 'member、engine、model 都要填。')
    return toolOk(id, `已收到换模型请求：${member} → ${model}`, { ok: true, member, engine: engineId, model })
  }
  if (name === 'resume_round') return toolOk(id, '已收到继续请求。', { ok: true })
  if (name === 'submit_plan') {
    const plan = args?.plan
    const crew = args?.crew
    if (plan === null || typeof plan !== 'object' || !Array.isArray(plan?.stages) || plan.stages.length === 0) {
      return toolFailure(id, '缺少 plan.stages：至少写一个阶段。')
    }
    if (!Array.isArray(crew?.executors) || crew.executors.length === 0) {
      return toolFailure(id, '缺少 crew.executors：至少写一位执行官。')
    }
    if (!Array.isArray(crew?.verifiers) || crew.verifiers.length === 0 || crew.verifiers.some(item => item === null || typeof item !== 'object')) {
      return toolFailure(id, '缺少 crew.verifiers：至少写一位验收员；默认一位，最多三位。')
    }
    return toolOk(id, '方案和队伍已提交，等平台校验。', { ok: true, kind: 'plan' })
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
    if (decision === 'PASS') {
      const raw = Array.isArray(args.coverage) ? args.coverage : []
      const valid = raw.filter(item => (
        item !== null &&
        typeof item === 'object' &&
        typeof item.item === 'string' &&
        item.item.trim() !== '' &&
        typeof item.evidence === 'string' &&
        item.evidence.trim() !== ''
      ))
      if (raw.length === 0 || valid.length !== raw.length) {
        return toolFailure(id, 'PASS 必须带 coverage：逐条写清目标或交付物里的要求原文（item）和你实际读过的文件、跑过的检查或看到的结果（evidence）。')
      }
    }
    const findings = Array.isArray(args.findings) ? args.findings.slice(0, 10) : []
    const blocking = findings.filter(item => (
      item !== null &&
      typeof item === 'object' &&
      (item.severity === 'blocker' || item.severity === 'major') &&
      typeof item.check === 'string' &&
      item.check.trim() !== ''
    ))
    if (decision === 'REJECT' && blocking.length === 0) {
      return toolFailure(id, '不通过至少要有一条带 check 的 blocker/major：check 写你实际跑的哪条检查或目标哪一行会因它失败。只有 minor 的问题请判通过。')
    }
    if (decision === 'PASS' && blocking.length > 0) {
      return toolFailure(id, '判通过不能同时带 blocker/major；要么改成不通过，要么先把问题降级并写清理由。')
    }
    const protectedRaw = Array.isArray(args.protectedFiles)
      ? args.protectedFiles
        .filter(item => typeof item === 'string' && item.trim() !== '')
        .map(item => item.trim().replaceAll('\\', '/').replace(/^\.\//, ''))
      : []
    if (protectedRaw.length > 20) {
      return toolFailure(id, '受保护文件超过 20 个，无法逐条确认；先缩小改动范围。')
    }
    const protectedFiles = protectedRaw
    let visual
    if (args.visual !== undefined) {
      const raw = args.visual
      if (raw === null || typeof raw !== 'object' || typeof raw.seen !== 'boolean') {
        return toolFailure(id, 'visual 必须包含 seen（true/false）；colors、contrast 用平台给的整数。')
      }
      if (raw.seen === false && (raw.colors !== undefined || raw.contrast !== undefined)) {
        return toolFailure(id, '看不到画面时不要填写 colors/contrast；seen:false 只说明没核对。')
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
      protectedFiles,
      ...(visual === undefined ? {} : { visual }),
    })
  }
  if (name === 'submit_decision') {
    const decision = plannerDecision(args.decision)
    if (decision === null) return toolFailure(id, 'decision 只能是 rework 或 human。')
    const options = Array.isArray(args.options)
      ? args.options.slice(0, 3).filter(item => (
        item !== null &&
        typeof item === 'object' &&
        typeof item.title === 'string' &&
        item.title.trim() !== '' &&
        (item.action === 'accept' || item.action === 'rework')
      ))
      : []
    return toolOk(id, `已收到规划决定：${decision}`, {
      ok: true,
      decision,
      reason,
      actionRequired: typeof args.actionRequired === 'string' ? args.actionRequired : '',
      ...(options.length === 0 ? {} : { options }),
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
  if (name === 'stop_round') {
    const why = String(args.reason ?? '').trim()
    if (why === '') return toolFailure(id, '写一句为什么停。')
    return toolOk(id, '已收到停止请求。', { ok: true, reason: why })
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
