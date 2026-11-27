import { judgmentFromGate } from './judgment.js'
import { normalizeAskDecision } from './decision.js'
import { normalizeCrewProposal } from './crew-proposal.js'

// 房间内置工具只用这一个 MCP 服务；规划和验收拿它提交判定，不拿外部工具。
export const GATE_SERVER_NAME = 'lodge_gate'

export const GATE_TOOL_NAMES = Object.freeze({
  submit_verdict: 'verdict',
  submit_decision: 'planner',
  submit_plan: 'plan',
  adjust_member_model: 'model',
  ask_decision: 'ask',
  ask_question: 'question',
})

const REWIND_TOOL = 'rewind_stage'
const STOP_TOOL = 'stop_round'
const RESUME_TOOL = 'resume_round'

const qualifiedNames = tool => [
  `${GATE_SERVER_NAME}_${tool}`,
  `${GATE_SERVER_NAME}__${tool}`,
  `mcp__${GATE_SERVER_NAME}__${tool}`,
  `${GATE_SERVER_NAME}.${tool}`,
  `${GATE_SERVER_NAME}:${tool}`,
]

const exactToolName = (name, tool) => {
  const text = String(name ?? '').trim()
  return text === tool || qualifiedNames(tool).includes(text)
}

const toolKind = name => {
  for (const [tool, kind] of Object.entries(GATE_TOOL_NAMES)) {
    if (exactToolName(name, tool)) return kind
  }
  return null
}

// 权限卡可能把整句问题放进 tool 字段；只认 lodge_gate 自己的完整名字。
const containsToolName = (text, tool) => {
  for (const form of qualifiedNames(tool)) {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`(^|[^A-Za-z0-9_])${escaped}($|[^A-Za-z0-9_])`).test(text)) return true
  }
  return false
}

export const isGateToolName = name => {
  const text = String(name ?? '')
  return [...Object.keys(GATE_TOOL_NAMES), REWIND_TOOL, STOP_TOOL, RESUME_TOOL].some(tool => containsToolName(text, tool))
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

// 被工具拒掉的调用不是一次提交：它的入参看着完整，平台也必须当没收到。
// 否则模型看到的是“被拒”，平台却按入参算了一票，两边各说各话。
const refused = call => call?.ok === false

const REFUSAL_LIMIT = 300

// 拒收的回执没有 submissionId，只剩这一句原话；房间和模型都要能读到它。
const refusalTextOf = output => {
  const parsed = typeof output === 'string'
    ? (() => { try { return JSON.parse(output) } catch { return null } })()
    : output
  if (parsed === null || typeof parsed !== 'object') {
    return typeof output === 'string' ? output.trim().slice(0, REFUSAL_LIMIT) : ''
  }
  const content = Array.isArray(parsed.content) ? parsed.content : []
  for (const item of content) {
    if (item !== null && typeof item === 'object' && typeof item.text === 'string' && item.text.trim() !== '') {
      return item.text.trim().slice(0, REFUSAL_LIMIT)
    }
  }
  return typeof parsed.error === 'string' ? parsed.error.trim().slice(0, REFUSAL_LIMIT) : ''
}

// 这一回合被判定工具拒掉的提交，带工具原话：模型按它改参数重交，房间按它说清为什么没结论。
export const gateRefusalsOf = (calls, { type = null } = {}) => {
  if (!Array.isArray(calls)) return []
  const refusals = []
  for (const call of calls) {
    const kind = toolKind(call?.name)
    if (kind === null || (type !== null && kind !== type) || !refused(call)) continue
    refusals.push({ tool: String(call?.name ?? ''), text: refusalTextOf(call?.output) })
  }
  return refusals
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
    if (kind === null || (type !== null && kind !== type) || refused(call)) continue
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

// 规划师给成员换模型：只认 member/engine/model 三个字段。
export const modelAdjustmentOf = calls => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    if (toolKind(call?.name) !== 'model') continue
    const input = parseInput(call?.input)
    if (input === null) return null
    const member = typeof input.member === 'string' ? input.member.trim() : ''
    const engine = typeof input.engine === 'string' ? input.engine.trim() : ''
    const model = typeof input.model === 'string' ? input.model.trim() : ''
    if (member === '' || engine === '' || model === '') return null
    return { member, engine, model, why: typeof input.why === 'string' ? input.why.trim().slice(0, 300) : '' }
  }
  return null
}

// 规划师提交方案和队伍：保留最后一次 plan 调用的归一化结果和错误，平台再校验策略。
export const submitPlanOf = calls => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    if (toolKind(call?.name) !== 'plan') continue
    const input = parseInput(call?.input)
    if (input === null) return { error: '方案的 JSON 读不出来' }
    return normalizeCrewProposal(input)
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
// 用户的意思是接着做：把停下的一轮接回来，目标不变。
export const resumeRequestOf = calls => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    if (exactToolName(call?.name, RESUME_TOOL)) return { at: Date.now() }
  }
  return null
}

// 用户说停、或规划师判断不值得继续：停这一轮，不再派活；这句理由进账本。
export const stopRequestOf = calls => {
  if (!Array.isArray(calls)) return null
  for (const call of [...calls].reverse()) {
    if (!exactToolName(call?.name, STOP_TOOL)) continue
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
    if (!exactToolName(call?.name, REWIND_TOOL)) continue
    const input = parseInput(call?.input)
    const stage = Number(input?.stage)
    const note = typeof input?.note === 'string' ? input.note.trim() : ''
    if (!Number.isInteger(stage) || stage < 1 || note === '') continue
    return { stage: stage - 1, note }
  }
  return null
}
