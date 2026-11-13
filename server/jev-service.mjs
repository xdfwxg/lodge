import { createServer } from 'node:http'

// 本地 Jev 参考实现：可独立运行，给 Gate / Verifier 返回结构化 advice。
// 它不写 pass，也不替代 Verifier；真实 Jev 可以用 JEV_URL 指向外部服务。
const evaluateGate = ({ goal, plan, verify, acceptance }) => {
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
    model: 'lodge-jev-reference',
    version: '1',
  }
}

const evaluateReview = ({ evidence, stage }) => {
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
    model: 'lodge-jev-reference',
    version: '1',
  }
}

const normalize = body => {
  if (body?.mode === 'review') return evaluateReview(body)
  return evaluateGate(body)
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

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || (req.url !== '/evaluate' && req.url !== '/')) {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }
  const body = await readJson(req)
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify(normalize(body)))
})

const port = Number(process.env.JEV_PORT ?? 8798)
server.listen(port, '127.0.0.1', () => {
  console.log(`Jev reference evaluator: http://127.0.0.1:${port}/evaluate`)
})
