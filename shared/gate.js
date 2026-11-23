import { judgmentFromGate } from './judgment.js'
import { normalizeAskDecision } from './decision.js'

// 房间内置工具只用这一个 MCP 服务；规划和验收拿它提交判定，不拿外部工具。
export const GATE_SERVER_NAME = 'lodge_gate'

export const GATE_TOOL_NAMES = Object.freeze({
  submit_verdict: 'verdict',
  submit_decision: 'planner',
  ask_decision: 'ask',
  ask_question: 'question',
})

const REWIND_TOOL = 'rewind_stage'
const STOP_TOOL = 'stop_round'

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
  return [...Object.keys(GATE_TOOL_NAMES), REWIND_TOOL, STOP_TOOL].some(tool => (
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

// 规划师提交一张决策卡：只认本轮最后一次合法 ask；结构由共享契约校验。
export const askDecisionOf = (calls, { id = null, roomId = null, roundId = null, stage = null, at = Date.now() } = {}) => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    if (toolKind(call?.name) !== 'ask') continue
    const result = normalizeAskDecision({
      id,
      roomId,
      roundId,
      stage,
      input: parseInput(call?.input),
      at,
    })
    if (result.error === undefined) return result.decision
  }
  return null
}

// 规划师缺事实时只问一个核心问题；问题由房间暂停等人回答，不混进决策卡。
export const askQuestionOf = (calls, { at = Date.now() } = {}) => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    if (toolKind(call?.name) !== 'question') continue
    const text = String(parseInput(call?.input)?.question ?? '').trim().slice(0, 500)
    if (text === '') continue
    return { text, at }
  }
  return null
}

// 规划师在对话里要求退回某一步：tool 的 stage 从 1 开始，内部步骤从 0 开始。
// 用户说停、或规划师判断不值得继续：停这一轮，不再派活；这句理由进账本。
export const stopRequestOf = calls => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    const name = String(call?.name ?? '')
    if (!qualifiedNames(STOP_TOOL).some(form => name.includes(form))) continue
    const input = parseInput(call?.input)
    const reason = typeof input?.reason === 'string' ? input.reason.trim().slice(0, 2000) : ''
    if (reason === '') continue
    return { reason }
  }
  return null
}

export const rewindRequestOf = calls => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    const name = String(call?.name ?? '')
    if (!qualifiedNames(REWIND_TOOL).some(form => name.includes(form))) continue
    const input = parseInput(call?.input)
    const stage = Number(input?.stage)
    const note = typeof input?.note === 'string' ? input.note.trim() : ''
    if (!Number.isInteger(stage) || stage < 1 || note === '') continue
    return { stage: stage - 1, note }
  }
  return null
}
