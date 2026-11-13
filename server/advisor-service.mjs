import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

// 本地 advisor 服务：可用规则评估，也可接一个 OpenAI 兼容模型做语义评估。
// 它只返回 advice，不写 verdict、不替代 Verifier。
const textOf = (value, max = 8_000) => typeof value === 'string' ? value.slice(0, max) : ''

const unique = items => [...new Set(items.filter(item => typeof item === 'string' && item.trim() !== ''))]

export const evaluateGateRules = ({ goal, plan, verify, acceptance }) => {
  const reasons = []
  const missingEvidence = []
  if (typeof goal !== 'string' || goal.trim() === '') reasons.push('目标为空')
  if (plan !== null && Array.isArray(plan?.done) === false) missingEvidence.push('done')
  if (verify === 'test' && typeof acceptance !== 'string') missingEvidence.push('验收命令')
  const score = reasons.length > 0 ? 0.25 : missingEvidence.length > 0 ? 0.55 : 0.8
  return {
    score,
    summary: reasons[0] ?? (missingEvidence.length > 0 ? `建议补齐：${missingEvidence.join('、')}` : '目标结构完整，可以进入规划'),
    reasons,
    risks: [],
    missingEvidence,
    model: 'lodge-advisor-rules',
    version: '2',
  }
}

export const evaluateReviewRules = ({ evidence, stage }) => {
  const reasons = []
  const risks = []
  const missingEvidence = []
  const command = typeof evidence?.command === 'string' ? evidence.command : ''
  const exit = evidence?.exit
  if (command === '') missingEvidence.push('验收命令')
  if (exit !== 0) reasons.push(`验收命令退出码 ${exit ?? '无'}`)
  if (!Array.isArray(evidence?.files) || evidence.files.length === 0) {
    missingEvidence.push('改动文件清单')
  }
  if (typeof evidence?.diff === 'string' && evidence.diff.trim() === '') {
    missingEvidence.push('diff 或产物证据')
  }
  if (stage?.manual === true) {
    risks.push('人工验收：需要 Verifier 实际打开产物核对')
  }
  const score = reasons.length > 0 ? 0.2 : missingEvidence.length > 0 ? 0.5 : 0.8
  return {
    score,
    summary: reasons[0] ?? (missingEvidence.length > 0 ? `证据不完整：${missingEvidence.join('、')}` : '证据结构完整，建议人工复核'),
    reasons,
    risks,
    missingEvidence,
    model: 'lodge-advisor-rules',
    version: '2',
  }
}

export const evaluateRules = body => body?.mode === 'review'
  ? evaluateReviewRules(body)
  : evaluateGateRules(body)

const SYSTEM_PROMPT = [
  '你是 advisor，一个独立的评估与打分服务，服务于多 Agent 房间的前置检查和独立复核。',
  '你只输出一个 JSON 对象，不要 Markdown，不要额外解释。',
  '字段：score（0 到 1 的数字）、summary（一句话结论）、reasons（字符串数组）、risks（字符串数组）、missingEvidence（字符串数组）。',
  '你给的是建议，不是通过/不通过的裁决；不要输出 verdict，不要声称替代验收员。',
  '证据不足时降低 score，并把它写进 missingEvidence；发现风险写进 risks。',
].join('\n')

const parseModelJson = text => {
  const raw = String(text ?? '').trim()
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  const start = unfenced.indexOf('{')
  const end = unfenced.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('模型没有返回 JSON')
  return JSON.parse(unfenced.slice(start, end + 1))
}

const normalizeModelAdvice = (parsed, model) => {
  const score = Number(parsed?.score)
  return {
    score: Number.isFinite(score) ? Math.min(1, Math.max(0, score)) : 0.5,
    summary: textOf(parsed?.summary, 1_000) || '模型没有给出摘要',
    reasons: unique(Array.isArray(parsed?.reasons) ? parsed.reasons : []).slice(0, 8),
    risks: unique(Array.isArray(parsed?.risks) ? parsed.risks : []).slice(0, 8),
    missingEvidence: unique(Array.isArray(parsed?.missingEvidence) ? parsed.missingEvidence : []).slice(0, 8),
    model,
    version: '2',
  }
}

const modelPayload = body => ({
  mode: body?.mode === 'review' ? 'review' : 'gate',
  goal: textOf(body?.goal, 2_000),
  roomType: textOf(body?.roomType, 40),
  plan: body?.plan ?? null,
  verify: textOf(body?.verify, 40),
  acceptance: textOf(body?.acceptance, 2_000),
  stage: body?.stage === undefined ? null : {
    title: textOf(body.stage?.title, 500),
    acceptance: textOf(body.stage?.acceptance, 2_000),
    manual: body.stage?.manual === true,
  },
  evidence: body?.evidence === undefined ? null : {
    command: textOf(body.evidence?.command, 2_000),
    exit: body.evidence?.exit,
    diff: textOf(body.evidence?.diff, 8_000),
    files: Array.isArray(body.evidence?.files) ? body.evidence.files.slice(0, 50) : [],
    text: textOf(body.evidence?.text, 4_000),
  },
})

export const evaluateWithModel = async (body, {
  url,
  key = '',
  model = 'advisor',
  fetchImpl = globalThis.fetch,
  timeoutMs = 20_000,
} = {}) => {
  if (typeof url !== 'string' || url.trim() === '') throw new Error('没有配置 ADVISOR_MODEL_URL')
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), Math.max(1_000, timeoutMs))
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === '' ? {} : { authorization: `Bearer ${key}` }),
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(modelPayload(body), null, 2) },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`模型 HTTP ${response.status}`)
    const answer = await response.json()
    const content = answer?.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') throw new Error('模型返回为空')
    return normalizeModelAdvice(parseModelJson(content), model)
  } finally {
    clearTimeout(timer)
  }
}

export const evaluate = async (body, options = {}) => {
  const {
    mode = process.env.ADVISOR_MODE ?? (process.env.ADVISOR_MODEL_URL ? 'model' : 'rules'),
    url = process.env.ADVISOR_MODEL_URL ?? '',
    key = process.env.ADVISOR_MODEL_KEY ?? '',
    model = process.env.ADVISOR_MODEL ?? 'advisor',
    timeoutMs = Number(process.env.ADVISOR_MODEL_TIMEOUT_MS ?? 20_000),
    fetchImpl = globalThis.fetch,
  } = options
  if (mode === 'model' && url !== '') {
    try {
      return await evaluateWithModel(body, { url, key, model, fetchImpl, timeoutMs })
    } catch (error) {
      return {
        ...evaluateRules(body),
        warning: `模型评估失败，已回退规则：${error?.message ?? error}`,
      }
    }
  }
  return evaluateRules(body)
}

const readJson = req => new Promise(resolve => {
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    try {
      resolve(JSON.parse(body))
    } catch {
      resolve({})
    }
  })
})

const json = (res, status, body) => {
  const data = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) })
  res.end(data)
}

export const createAdvisorServer = () => createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    const mode = process.env.ADVISOR_MODE ?? (process.env.ADVISOR_MODEL_URL ? 'model' : 'rules')
    return json(res, 200, {
      ok: true,
      mode,
      model: mode === 'model' ? process.env.ADVISOR_MODEL ?? 'advisor' : 'lodge-advisor-rules',
      version: '2',
    })
  }
  if (req.method !== 'POST' || (req.url !== '/evaluate' && req.url !== '/')) {
    return json(res, 404, { error: 'not found' })
  }
  const body = await readJson(req)
  return json(res, 200, await evaluate(body))
})

export const startAdvisorServer = ({ port = Number(process.env.ADVISOR_PORT ?? 8798), host = '127.0.0.1' } = {}) => {
  const server = createAdvisorServer()
  server.listen(port, host, () => {
    const mode = process.env.ADVISOR_MODE ?? (process.env.ADVISOR_MODEL_URL ? 'model' : 'rules')
    console.log(`Advisor evaluator (${mode}): http://${host}:${port}/evaluate`)
  })
  return server
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startAdvisorServer()
}
