import { judgmentFromGate } from './judgment.js'

// 房间内置工具只用这一个 MCP 服务；规划和验收拿它提交判定，不拿外部工具。
export const GATE_SERVER_NAME = 'lodge_gate'

export const GATE_TOOL_NAMES = Object.freeze({
  submit_verdict: 'verdict',
  submit_decision: 'planner',
})

const qualifiedNames = tool => [
  `${GATE_SERVER_NAME}_${tool}`,
  `${GATE_SERVER_NAME}__${tool}`,
  `mcp__${GATE_SERVER_NAME}__${tool}`,
  `${GATE_SERVER_NAME}.${tool}`,
  `${GATE_SERVER_NAME}:${tool}`,
]

const toolKind = name => {
  const text = String(name ?? '')
  for (const [tool, kind] of Object.entries(GATE_TOOL_NAMES)) {
    if (text === tool || qualifiedNames(tool).includes(text)) return kind
  }
  return null
}

// 权限卡用的是 server:tool 形式；基座有时会把整句问题放进 tool 字段，所以认句中的名字。
// 只认 lodge_gate 自己的工具，不认别的 MCP。
export const isGateToolName = name => {
  const text = String(name ?? '')
  return Object.keys(GATE_TOOL_NAMES).some(tool => (
    qualifiedNames(tool).some(form => text.includes(form))
  ))
}

const parseInput = value => {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || value.trim() === '') return null
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

// 同一回合可能重试或先调错一次；取最后一次合法提交。
export const gateSubmissionOf = (calls, {
  type = null,
  stage = null,
  evidenceId = null,
  actorId = null,
  at = Date.now(),
} = {}) => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    const kind = toolKind(call?.name)
    if (kind === null || (type !== null && kind !== type)) continue
    const judgment = judgmentFromGate({
      type: kind,
      input: parseInput(call?.input),
      stage,
      evidenceId,
      actorId,
      at,
    })
    if (judgment !== null) return judgment
  }
  return null
}
