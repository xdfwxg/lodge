// “这家模型现在能不能干活”只在这里判断：列表、登录入口和按钮门禁都读同一份结果。
export const engineBlockReason = (engine, { requireApproval = false } = {}) => {
  if (engine === undefined || engine === null) return '没有这个模型服务'
  if (engine.available !== true) return '模型服务不可用'
  if (engine.authenticated === false) return '登录失效'
  if (requireApproval === true && engine.capabilities?.approvalReview !== true) return '不会先问你外部动作'
  return ''
}

export const engineReady = (engine, options = {}) => engineBlockReason(engine, options) === ''

export const engineReadiness = (engines, { requireApproval = false } = {}) => {
  const list = Array.isArray(engines) ? engines : []
  const installed = list.filter(item => item.available === true)
  const usable = installed.filter(item => item.authenticated !== false)
  const ready = usable.filter(item => requireApproval !== true || item.capabilities?.approvalReview === true)
  const missingLogin = installed.filter(item => item.authenticated === false && (
    requireApproval !== true || item.capabilities?.approvalReview === true
  ))
  const loginTargets = missingLogin.filter(item => Array.isArray(item.login?.args))
  const manualLogin = missingLogin.filter(item => !Array.isArray(item.login?.args))
  const noApproval = requireApproval === true
    ? usable.filter(item => item.capabilities?.approvalReview !== true)
    : []
  return {
    installed,
    usable,
    ready,
    missingLogin,
    loginTargets,
    manualLogin,
    noApproval,
    canStart: ready.length > 0,
  }
}
