// Gate 是工作室引擎的前置管道，不是角色。它只决定目标能不能进入规划，
// 不做拆解、不写方案；Jev 建议只作为 advice 附回，不产生业务判定。
export const evaluateRoomGate = ({ roomType, goal, plan, verify, acceptance, advice = [] }) => {
  if (roomType !== 'studio') {
    return { decision: 'allow', reasons: [], advice: [] }
  }
  const reasons = []
  const text = typeof goal === 'string' ? goal.trim() : ''
  if (text === '') reasons.push('目标为空')
  if (text.length > 2000) reasons.push('目标超过 2000 字')
  if (plan !== null && (!Array.isArray(plan.done) || plan.done.length === 0)) {
    reasons.push('开工卡没有可核对的 done')
  }
  const plannedAcceptance = Array.isArray(plan?.stages) &&
    plan.stages.some(stage => typeof stage.acceptance === 'string' && stage.acceptance.trim() !== '')
  if (verify === 'test' && acceptance === '' && !plannedAcceptance) {
    reasons.push('交付型工作室没有验收标准')
  }
  return {
    decision: reasons.length > 0 ? 'reject' : 'allow',
    reasons,
    advice: Array.isArray(advice) ? advice : [],
  }
}
