// 判定契约：模型给语义，首行锚点决定结论，JSON 明细承载理由与发现项。
// 字段对齐 LoopForge 的 GateResult（MIT）：decision/reason/actionRequired/findings + 长度上限。
// 服务端与 UI 只读这份结构，不再各自解析自然语言。
export const JUDGMENT_VERSION = 1

const LIMITS = Object.freeze({
  reason: 2000,
  actionRequired: 1000,
  findings: 10,
  title: 200,
  evidence: 2000,
})

const SEVERITIES = new Set(['blocker', 'major', 'minor'])
const VERDICT_DECISIONS = new Set(['pass', 'reject'])
const PLANNER_DECISIONS = new Set(['rework', 'human'])
const REJECT_TARGETS = new Set(['planner', 'worker', 'human'])

export const GATE_DECISIONS = Object.freeze(['pass', 'rework', 'fail', 'human'])

const rejectToFor = (type, decision) => {
  if (type === 'planner') return decision === 'human' ? 'human' : 'worker'
  return decision === 'pass' ? null : 'planner'
}

const clip = (value, max) => {
  const text = String(value ?? '').trim()
  return text.length > max ? text.slice(0, max) : text
}

const firstLine = text => {
  const line = String(text ?? '').split('\n').map(item => item.trim()).find(item => item !== '') ?? ''
  return line.replace(/^[*#>\s]+/, '').replace(/^(结论|判定|验收结论|verdict)\s*[:：]?\s*/i, '')
}

// 判定不清按退回，与旧 parseVerdict 的语义保持一致。
const verdictDecision = text => {
  const head = firstLine(text)
  if (/(REJECT|不通过|未通过|无法通过|不能通过|没有通过|退回|打回|拒绝|失败)/i.test(head)) return 'reject'
  if (/(PASS|通过|接受|同意)/i.test(head)) return 'pass'
  return 'reject'
}

const plannerDecision = text => (
  /(返工|REWORK)/i.test(firstLine(text)) ? 'rework' : 'human'
)

export const extractJudgmentJson = text => {
  // 代码块可能另起一行，也可能和第一行连在一起；两种都认。
  const blocks = String(text ?? '').matchAll(/```(?:json)?[ \t]*(?:\r?\n)?([\s\S]*?)```/gi)
  for (const block of blocks) {
    const raw = block[1].trim()
    if (!raw.startsWith('{')) continue
    try {
      const value = JSON.parse(raw)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
    } catch {
      // 模型偶尔先给一个示例块；继续找下一个。
    }
  }
  return null
}

const stripJudgmentJson = text => String(text ?? '')
  .replace(/```(?:json)?[ \t]*(?:\r?\n)?[\s\S]*?```/gi, '')
  .trim()

const stripAnchor = text => String(text ?? '')
  .replace(/^[\s*#>]*(?:(?:结论|判定|验收结论|verdict)\s*[:：]?\s*)?(PASS|REJECT|REWORK|返工|交给人)[\s*]*[：:\-]?\s*/i, '')
  .trim()

const normalizeFindings = value => {
  if (!Array.isArray(value)) return []
  const findings = []
  for (const item of value) {
    if (typeof item === 'string') {
      const title = clip(item, LIMITS.title)
      if (title !== '') findings.push({ title, severity: 'minor', evidence: '' })
      continue
    }
    if (item === null || typeof item !== 'object') continue
    const title = clip(item.title, LIMITS.title)
    if (title === '') continue
    const raw = typeof item.severity === 'string' ? item.severity.trim().toLowerCase() : ''
    findings.push({
      title,
      severity: SEVERITIES.has(raw) ? raw : 'minor',
      evidence: clip(item.evidence, LIMITS.evidence),
    })
    if (findings.length >= LIMITS.findings) break
  }
  return findings
}

export const normalizeJudgment = ({ type, text, stage = null, evidenceId = null, actorId = null, at = Date.now() }) => {
  const decision = type === 'planner' ? plannerDecision(text) : verdictDecision(text)
  const json = extractJudgmentJson(text)
  const reason = clip(json?.reason ?? stripAnchor(stripJudgmentJson(text)), LIMITS.reason)
  const actionRequired = clip(json?.actionRequired, LIMITS.actionRequired)
  return {
    version: JUDGMENT_VERSION,
    type,
    decision,
    reason,
    findings: type === 'verdict' ? normalizeFindings(json?.findings) : [],
    actionRequired: actionRequired !== '' ? actionRequired : (decision === 'human' ? reason : ''),
    stage: Number.isInteger(stage) ? stage : null,
    evidenceId: typeof evidenceId === 'string' && evidenceId !== '' ? evidenceId : null,
    actorId: typeof actorId === 'string' && actorId !== '' ? actorId : null,
    rejectTo: rejectToFor(type, decision),
    at: typeof at === 'number' ? at : Date.now(),
    source: json === null ? 'text' : 'json',
  }
}

const GATE_VERDICT = new Map([
  ['pass', 'pass'],
  ['通过', 'pass'],
  ['接受', 'pass'],
  ['同意', 'pass'],
  ['reject', 'reject'],
  ['fail', 'reject'],
  ['不通过', 'reject'],
  ['未通过', 'reject'],
  ['退回', 'reject'],
  ['拒绝', 'reject'],
  ['失败', 'reject'],
])

const GATE_PLANNER = new Map([
  ['rework', 'rework'],
  ['返工', 'rework'],
  ['重做', 'rework'],
  ['human', 'human'],
  ['handoff', 'human'],
  ['交给人', 'human'],
  ['人工', 'human'],
  ['转人工', 'human'],
])

// MCP gate 直接给结构化字段，不再经过首行文本；字段仍汇入同一份契约。
export const judgmentFromGate = ({
  type,
  input,
  stage = null,
  evidenceId = null,
  actorId = null,
  at = Date.now(),
}) => {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return null
  const table = type === 'planner' ? GATE_PLANNER : GATE_VERDICT
  const decision = table.get(String(input.decision ?? '').trim().toLowerCase())
  if (decision === undefined) return null
  const reason = clip(input.reason ?? input.message, LIMITS.reason)
  if (reason === '') return null
  const actionRequired = clip(input.actionRequired, LIMITS.actionRequired)
  return validateJudgment({
    version: JUDGMENT_VERSION,
    type,
    decision,
    reason,
    findings: type === 'verdict' ? normalizeFindings(input.findings) : [],
    actionRequired: actionRequired !== '' ? actionRequired : (decision === 'human' ? reason : ''),
    // rejectTo 是业务路由，模型不能把失败退回给别的角色。
    rejectTo: rejectToFor(type, decision),
    stage,
    evidenceId,
    actorId,
    at,
    source: 'gate',
  })
}

export const validateJudgment = value => {
  if (value === null || typeof value !== 'object') return null
  if (value.version !== JUDGMENT_VERSION) return null
  const type = value.type === 'planner' ? 'planner' : value.type === 'verdict' ? 'verdict' : null
  if (type === null) return null
  const decision = String(value.decision ?? '').trim().toLowerCase()
  const allowed = type === 'planner' ? PLANNER_DECISIONS : VERDICT_DECISIONS
  if (!allowed.has(decision)) return null
  return {
    version: JUDGMENT_VERSION,
    type,
    decision,
    reason: clip(value.reason, LIMITS.reason),
    findings: type === 'verdict' ? normalizeFindings(value.findings) : [],
    actionRequired: clip(value.actionRequired, LIMITS.actionRequired),
    stage: Number.isInteger(value.stage) ? value.stage : null,
    evidenceId: typeof value.evidenceId === 'string' && value.evidenceId !== '' ? value.evidenceId : null,
    actorId: typeof value.actorId === 'string' && value.actorId !== '' ? value.actorId : null,
    rejectTo: REJECT_TARGETS.has(value.rejectTo) ? value.rejectTo : rejectToFor(type, decision),
    at: typeof value.at === 'number' ? value.at : 0,
    source: ['json', 'text', 'legacy', 'gate'].includes(value.source) ? value.source : 'text',
  }
}

// 老消息没有契约：从派生的 pass/reason 合成一份只读契约，不写回存储。
export const judgmentOf = message => {
  const stored = validateJudgment(message?.meta?.judgment)
  if (stored !== null) return stored
  const pass = message?.meta?.pass
  if (pass !== true && pass !== false) return null
  return {
    version: JUDGMENT_VERSION,
    type: 'verdict',
    decision: pass ? 'pass' : 'reject',
    reason: clip(message?.meta?.reason ?? message?.text, LIMITS.reason),
    findings: [],
    actionRequired: '',
    stage: Number.isInteger(message?.meta?.stage) ? message.meta.stage : null,
    evidenceId: typeof message?.meta?.evidenceId === 'string' ? message.meta.evidenceId : null,
    actorId: typeof message?.authorId === 'string' ? message.authorId : null,
    rejectTo: pass ? null : 'planner',
    at: typeof message?.ts === 'number' ? message.ts : 0,
    source: 'legacy',
  }
}

export const verdictPassed = message => judgmentOf(message)?.decision === 'pass'

export const plannerDecisionOf = room => validateJudgment(room?.lastPlannerDecision?.judgment)

// 统一的人工门视图：验收的 reject 就是 GateResult 里的 fail。
export const gateResultOf = judgment => {
  const valid = validateJudgment(judgment)
  if (valid === null) return null
  return {
    decision: valid.type === 'verdict'
      ? (valid.decision === 'pass' ? 'pass' : 'fail')
      : valid.decision,
    reason: valid.reason,
    actionRequired: valid.actionRequired,
    findings: valid.findings,
    rejectTo: valid.rejectTo,
  }
}

export const VERDICT_JSON_HINT = '第二行起附一段 ```json 代码块：{"reason":"一句话结论","findings":[{"title":"缺口","severity":"blocker","evidence":"具体证据"}]}；最多 3 条 findings，没有就写空数组。'

export const DECISION_JSON_HINT = '第二行起附一段 ```json 代码块：{"reason":"怎么改 / 要人拍板什么","actionRequired":"要人做什么"}；“交给人”时 actionRequired 必填，缺失时用 reason 兜底。'
