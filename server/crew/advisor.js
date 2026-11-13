// advisor 是外部评估/打分端口：只返回建议，不产生 verdict，也不阻塞主链路。
// 配置只读 ADVISOR_*；以后接外部产品时再新增独立适配器，不做名字别名。
const normalizeAdvice = body => {
  const raw = Array.isArray(body?.advice)
    ? body.advice
    : body?.score === undefined && body?.reasons === undefined
      ? []
      : [body]
  return raw.slice(0, 10).map(item => ({
    source: 'advisor',
    ...(Number.isFinite(item?.score) ? { score: item.score } : {}),
    ...(Array.isArray(item?.reasons) ? { reasons: item.reasons.slice(0, 8) } : {}),
    ...(Array.isArray(item?.risks) ? { risks: item.risks.slice(0, 8) } : {}),
    ...(Array.isArray(item?.missingEvidence) ? { missingEvidence: item.missingEvidence.slice(0, 8) } : {}),
    ...(typeof item?.summary === 'string' ? { summary: item.summary.slice(0, 1000) } : {}),
  }))
}

export const createAdvisorClient = ({
  url = process.env.ADVISOR_URL ?? '',
  token = process.env.ADVISOR_TOKEN ?? '',
  timeoutMs = Number(process.env.ADVISOR_TIMEOUT_MS ?? 8000),
} = {}) => {
  const available = typeof url === 'string' && url.trim() !== ''

  const advice = async ({ mode, ...payload }) => {
    if (!available) return { available: false, advice: [] }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs))
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === '' ? {} : { authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ mode, ...payload }),
        signal: controller.signal,
      })
      if (!response.ok) throw new Error(`advisor HTTP ${response.status}`)
      const body = await response.json().catch(() => ({}))
      return {
        available: true,
        advice: normalizeAdvice(body),
        ...(typeof body?.model === 'string' ? { model: body.model } : {}),
        ...(typeof body?.version === 'string' ? { version: body.version } : {}),
      }
    } catch (error) {
      return { available: false, advice: [], error: String(error?.message ?? error) }
    } finally {
      clearTimeout(timer)
    }
  }

  return { available, advice }
}
