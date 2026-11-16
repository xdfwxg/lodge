// “这家模型现在能不能干活”只在这里判断：列表、登录入口、服务端门禁读同一份规则。
export const engineHasModel = engine => {
  if (engine?.models === undefined || engine?.models === null) return true
  if (typeof engine.models.default === 'string' && engine.models.default.trim() !== '') return true
  return Array.isArray(engine.models.options) && engine.models.options.some(item => typeof item?.id === 'string' && item.id !== '')
}

export const engineBlockReason = (engine, { requireApproval = false } = {}) => {
  if (engine === undefined || engine === null) return '没有这个模型服务'
  if (engine.available !== true) return engine.reason === '' || engine.reason === undefined ? '模型服务不可用' : engine.reason
  if (engine.authenticated === false) return '登录失效'
  if (!engineHasModel(engine)) return '没有配置模型'
  if (requireApproval === true && engine.capabilities?.approvalReview !== true) return '不会先问你外部动作'
  return ''
}

export const engineReady = (engine, options = {}) => engineBlockReason(engine, options) === ''

export const engineBlockLabel = reason => (
  reason === '登录失效' ? '未登录'
    : reason === '没有配置模型' ? '未配置模型'
      : '不能执行'
)

export const engineReadiness = (engines, { requireApproval = false } = {}) => {
  const list = Array.isArray(engines) ? engines : []
  const installed = list.filter(item => item.available === true)
  const usable = installed.filter(item => item.authenticated !== false)
  const withModel = usable.filter(item => engineHasModel(item))
  const ready = withModel.filter(item => requireApproval !== true || item.capabilities?.approvalReview === true)
  const missingLogin = installed.filter(item => item.authenticated === false && (
    requireApproval !== true || item.capabilities?.approvalReview === true
  ))
  const loginTargets = missingLogin.filter(item => Array.isArray(item.login?.args))
  const manualLogin = missingLogin.filter(item => !Array.isArray(item.login?.args))
  const noModels = usable.filter(item => !engineHasModel(item))
  const noApproval = requireApproval === true
    ? withModel.filter(item => item.capabilities?.approvalReview !== true)
    : []
  return {
    installed,
    ready,
    missingLogin,
    loginTargets,
    manualLogin,
    noModels,
    noApproval,
    canStart: ready.length > 0,
  }
}
