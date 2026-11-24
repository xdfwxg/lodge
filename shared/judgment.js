// 判定契约：模型给语义，首行锚点决定结论，JSON 明细承载理由与发现项。
// 字段对齐 LoopForge 的 GateResult（MIT）：decision/reason/actionRequired/findings + 长度上限。
// 服务端与 UI 只读这份结构，不再各自解析自然语言。
export const JUDGMENT_VERSION = 1

export const LIMITS = Object.freeze({
  reason: 2000,
  actionRequired: 1000,
  findings: 10,
  title: 200,
  evidence: 2000,
  check: 300,
  outsideDiff: 500,
  protectedFiles: 20,
})

const SEVERITIES = new Set(['blocker', 'major', 'minor'])
const VERDICT_DECISIONS = new Set(['pass', 'reject'])
const PLANNER_DECISIONS = new Set(['rework', 'human'])
const REJECT_TARGETS = new Set(['planner', 'worker', 'human'])

const rejectToFor = (type, decision) => {
  if (type === 'planner') return decision === 'human' ? 'human' : 'worker'
  return decision === 'pass' ? null : 'planner'
}

const normalizePath = value => String(value ?? '').trim().replaceAll('\\', '/').replace(/^\.\//, '')

const normalizeProtectedFiles = value => (
  [...new Set((Array.isArray(value) ? value : [])
    .filter(item => typeof item === 'string' && item.trim() !== '')
    .map(item => normalizePath(clip(item, 200)))
    .filter(item => item !== ''))].slice(0, LIMITS.protectedFiles)
)

const clip = (value, max) => {
  const text = String(value ?? '').trim()
  return text.length > max ? text.slice(0, max) : text
}

const firstLine = text => {
  const line = String(text ?? '').split('\n').map(item => item.trim()).find(item => item !== '') ?? ''
  return line.replace(/^[*#>\s]+/, '').replace(/^(结论|判定|验收结论|verdict)\s*[:：]?\s*/i, '')
}

const VERDICT_REJECT = /(REJECT|不通过|未通过|无法通过|不能通过|没有通过|退回|打回|拒绝|失败)/i
// 判定词后面必须断开，否则“通过率 98%”会被当成判定。
const PASS_END = String.raw`(?=$|[\s，,。.；;：:、*\-!！?？])`
const VERDICT_PASS = new RegExp(String.raw`(?:PASS|通过|接受|同意)${PASS_END}`, 'i')
// 首行以“通过”开头就是通过；“通过，没有失败”里的“失败”不是判定。
const LEADING_PASS = new RegExp(String.raw`^(?:PASS|通过|接受|同意)${PASS_END}`, 'i')
const PLANNER_REWORK = /(返工|REWORK)/i
const PLANNER_HUMAN = /(交给人|转人工|handoff|human)/i

// 首行是不是一个明确的判定锚点；没有锚点就说明模型在解释而不是下结论。
export const judgmentAnchorOf = (type, text) => {
  const head = firstLine(text)
  if (head === '') return null
  if (type === 'planner') {
    if (PLANNER_REWORK.test(head)) return 'rework'
    if (PLANNER_HUMAN.test(head)) return 'human'
    return null
  }
  if (LEADING_PASS.test(head)) return 'pass'
  if (VERDICT_REJECT.test(head)) return 'reject'
  if (VERDICT_PASS.test(head)) return 'pass'
  return null
}

// 判定不清按退回，与旧 parseVerdict 的语义保持一致。
const verdictDecision = text => {
  const head = firstLine(text)
  if (LEADING_PASS.test(head)) return 'pass'
  if (VERDICT_REJECT.test(head)) return 'reject'
  if (VERDICT_PASS.test(head)) return 'pass'
  return 'reject'
}

const plannerDecision = text => (
  PLANNER_REWORK.test(firstLine(text)) ? 'rework' : 'human'
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
  .replace(/^[\s*#>]*(?:(?:结论|判定|验收结论|verdict)\s*[:：]?\s*)?(?:(?:PASS|REJECT|REWORK)\b|不通过|通过(?=[\s*：:\-]|$)|返工|交给人)[\s*]*[：:\-]?\s*/i, '')
  .trim()

// 视觉核对：seen 必须说清看没看到图；数字只能引用平台给的像素检查结果。
const normalizeVisual = value => {
  if (value === null || typeof value !== 'object' || typeof value.seen !== 'boolean') return null
  return {
    seen: value.seen,
    ...(Number.isInteger(value.colors) && value.colors >= 0 ? { colors: value.colors } : {}),
    ...(Number.isInteger(value.contrast) && value.contrast >= 0 ? { contrast: value.contrast } : {}),
  }
}

const DECISION_OPTION_ACTIONS = new Set(['accept', 'rework'])

const normalizeDecisionOptions = value => {
  if (!Array.isArray(value)) return []
  const options = []
  const usedIds = new Set()
  for (const [index, item] of value.slice(0, 3).entries()) {
    if (item === null || typeof item !== 'object') continue
    const title = clip(item.title, 120)
    const action = String(item.action ?? '').trim().toLowerCase()
    if (title === '' || !DECISION_OPTION_ACTIONS.has(action)) continue
    const detail = clip(item.detail, 300)
    // 选项 id 是界面的 key 和选中值，重复会让两张卡互相覆盖。
    const baseId = clip(item.id, 40) || String.fromCharCode(65 + index)
    let id = baseId
    for (let suffix = 2; usedIds.has(id); suffix += 1) id = `${baseId}-${suffix}`
    usedIds.add(id)
    options.push({
      id,
      title,
      detail,
      action,
      text: detail === '' ? title : `${title}：${detail}`,
    })
  }
  return options
}

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
    const check = clip(item.check, LIMITS.check)
    findings.push({
      title,
      severity: SEVERITIES.has(raw) ? raw : 'minor',
      evidence: clip(item.evidence, LIMITS.evidence),
      ...(check !== '' ? { check } : {}),
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
    visual: type === 'verdict' ? normalizeVisual(json?.visual) : null,
    outsideDiff: type === 'verdict' ? clip(json?.outsideDiff, LIMITS.outsideDiff) : '',
    protectedFiles: type === 'verdict' ? normalizeProtectedFiles(json?.protectedFiles) : [],
    actionRequired: actionRequired !== '' ? actionRequired : (decision === 'human' ? reason : ''),
    options: type === 'planner' ? normalizeDecisionOptions(json?.options) : [],
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
  const outsideDiff = type === 'verdict' ? clip(input.outsideDiff, LIMITS.outsideDiff) : ''
  // 和 gate MCP 的入口校验保持一致：PASS 不能绕过“diff 之外的一条风险”。
  if (type === 'verdict' && decision === 'pass' && outsideDiff === '') return null
  // 退回必须挂到一条会失败的检查：没有 check 的 blocker/major 只是意见，降为 minor。
  // 一条带 check 的阻塞项都没有，就不是一次有效的退回。
  const findings = type === 'verdict' ? normalizeFindings(input.findings).map(item => (
    (item.severity === 'blocker' || item.severity === 'major') && typeof item.check !== 'string'
      ? { ...item, severity: 'minor' }
      : item
  )) : []
  if (type === 'verdict' && decision === 'reject' && !findings.some(item => (
    (item.severity === 'blocker' || item.severity === 'major') && typeof item.check === 'string'
  ))) return null
  const actionRequired = clip(input.actionRequired, LIMITS.actionRequired)
  return validateJudgment({
    version: JUDGMENT_VERSION,
    type,
    decision,
    reason,
    findings,
    visual: type === 'verdict' ? normalizeVisual(input.visual) : null,
    outsideDiff,
    protectedFiles: type === 'verdict' ? normalizeProtectedFiles(input.protectedFiles) : [],
    actionRequired: actionRequired !== '' ? actionRequired : (decision === 'human' ? reason : ''),
    options: type === 'planner' ? normalizeDecisionOptions(input.options) : [],
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
    visual: type === 'verdict' ? normalizeVisual(value.visual) : null,
    outsideDiff: type === 'verdict' ? clip(value.outsideDiff, LIMITS.outsideDiff) : '',
    protectedFiles: type === 'verdict' ? normalizeProtectedFiles(value.protectedFiles) : [],
    actionRequired: clip(value.actionRequired, LIMITS.actionRequired),
    options: type === 'planner' ? normalizeDecisionOptions(value.options) : [],
    stage: Number.isInteger(value.stage) ? value.stage : null,
    evidenceId: typeof value.evidenceId === 'string' && value.evidenceId !== '' ? value.evidenceId : null,
    actorId: typeof value.actorId === 'string' && value.actorId !== '' ? value.actorId : null,
    rejectTo: REJECT_TARGETS.has(value.rejectTo) ? value.rejectTo : rejectToFor(type, decision),
    at: typeof value.at === 'number' ? value.at : 0,
    source: ['json', 'text', 'gate', 'missing', 'policy'].includes(value.source) ? value.source : 'text',
  }
}

export const judgmentOf = message => validateJudgment(message?.meta?.judgment)

// 判定契约是结论的来源；meta.pass 只是写入时留下的派生镜像，仍供旧的读取点使用。
export const verdictPassed = message => {
  const judgment = judgmentOf(message)
  return judgment === null ? message?.meta?.pass === true : judgment.decision === 'pass'
}

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
    options: valid.options,
    findings: valid.findings,
    rejectTo: valid.rejectTo,
  }
}

export const VERDICT_JSON_HINT = '第二行起附一段 ```json 代码块：{"reason":"一句话结论","findings":[{"title":"缺口","severity":"blocker","evidence":"具体证据","check":"你实际跑的哪条检查或目标哪一行会因它失败"}],"outsideDiff":"diff 之外最值得担心的一条风险；没有就写「无」"}；最多 3 条 findings，没有就写空数组。不通过至少要有一条带 check 的 blocker/major；只有 minor 的问题请判通过。'

export const DECISION_JSON_HINT = '第二行起附一段 ```json 代码块：{"reason":"怎么改 / 要人拍板什么","actionRequired":"要人做什么"}；“交给人”时 actionRequired 必填，缺失时用 reason 兜底。'
