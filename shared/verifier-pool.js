// 验收员池：探针实测过的模型才进池；误放率过高的模型不再接验收。
// 未实测的模型不拦开工，但要如实标注，不能假装它有实测记录。
export const VERIFIER_POOL_VERSION = 1
export const POOL_MIN_DEFECT_SAMPLES = 10
export const POOL_MIN_CLEAN_SAMPLES = 5
export const POOL_MAX_FALSE_PASS_RATE = 0.05

export const verifierKeyOf = ({ engine, model } = {}) => {
  const engineText = typeof engine === 'string' ? engine.trim() : ''
  const modelText = typeof model === 'string' ? model.trim() : ''
  return engineText === '' || modelText === '' ? '' : `${engineText}:${modelText}`
}

const rateOf = (part, total) => (total === 0 ? null : part / total)

const statusOf = ({ defectSamples, cleanSamples, falsePass }) => {
  if (defectSamples < POOL_MIN_DEFECT_SAMPLES || cleanSamples < POOL_MIN_CLEAN_SAMPLES) return 'insufficient'
  return falsePass / defectSamples > POOL_MAX_FALSE_PASS_RATE ? 'excluded' : 'eligible'
}

// 探针结果按验收员模型分组；缺陷样本看误放，对照样本看误拒。
export const poolFromProbeResults = (results, { updatedAt = new Date().toISOString() } = {}) => {
  const models = {}
  for (const row of Array.isArray(results) ? results : []) {
    const key = verifierKeyOf({ engine: row?.verifierEngine, model: row?.verifierModel })
    if (key === '') continue
    const entry = models[key] ?? {
      engine: String(row.verifierEngine).trim(),
      model: String(row.verifierModel).trim(),
      defectSamples: 0,
      caught: 0,
      falsePass: 0,
      cleanSamples: 0,
      correctPass: 0,
      falseReject: 0,
    }
    if (row.kind === 'defect' && ['caught', 'false-pass'].includes(row.outcome)) {
      entry.defectSamples += 1
      if (row.outcome === 'caught') entry.caught += 1
      else entry.falsePass += 1
    }
    if (row.kind === 'clean' && ['correct-pass', 'false-reject'].includes(row.outcome)) {
      entry.cleanSamples += 1
      if (row.outcome === 'correct-pass') entry.correctPass += 1
      else entry.falseReject += 1
    }
    models[key] = entry
  }
  for (const entry of Object.values(models)) {
    entry.falsePassRate = rateOf(entry.falsePass, entry.defectSamples)
    entry.falseRejectRate = rateOf(entry.falseReject, entry.cleanSamples)
    entry.status = statusOf(entry)
  }
  return {
    version: VERIFIER_POOL_VERSION,
    updatedAt,
    thresholds: {
      minDefectSamples: POOL_MIN_DEFECT_SAMPLES,
      minCleanSamples: POOL_MIN_CLEAN_SAMPLES,
      maxFalsePassRate: POOL_MAX_FALSE_PASS_RATE,
    },
    models,
  }
}

export const parseVerifierPool = value => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value.version !== VERIFIER_POOL_VERSION) return null
  if (value.models === null || typeof value.models !== 'object' || Array.isArray(value.models)) return null
  return value
}

// 一次探针通常只跑一个验收模型；写池时保留其它模型已经测过的结果。
export const mergeVerifierPools = (base, next) => {
  const left = parseVerifierPool(base)
  const right = parseVerifierPool(next)
  if (right === null) return left
  if (left === null) return right
  return {
    ...right,
    models: { ...left.models, ...right.models },
  }
}

const percent = value => `${Math.round(value * 100)}%`

// 返回 { error } 拦截一位验收员，或 { warning } 说明它还没有足够的实测样本。
export const verifierPoolIssue = ({ pool, engine, model }) => {
  const parsed = parseVerifierPool(pool)
  if (parsed === null) return {}
  const key = verifierKeyOf({ engine, model })
  if (key === '') return {}
  const entry = parsed.models[key]
  if (entry === undefined) {
    return { warning: `验收员 ${engine}:${model} 还没有实测记录；这一轮只能按未实测处理。` }
  }
  if (entry.status === 'excluded') {
    const rate = typeof entry.falsePassRate === 'number' ? percent(entry.falsePassRate) : '未知'
    return { error: `验收员 ${engine}:${model} 的探针误放率是 ${rate}，超过 ${percent(POOL_MAX_FALSE_PASS_RATE)}；换一位验收员。` }
  }
  if (entry.status === 'insufficient') {
    return { warning: `验收员 ${engine}:${model} 的实测样本还不够（缺陷 ${entry.defectSamples}/${POOL_MIN_DEFECT_SAMPLES}、对照 ${entry.cleanSamples}/${POOL_MIN_CLEAN_SAMPLES}）；这一轮按未充分实测处理。` }
  }
  return {}
}
