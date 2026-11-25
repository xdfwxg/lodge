// PASS 的覆盖表必须对得上这一阶段真正要交的东西：有契约时按 clause id，老房间退回交付物/目标文本。
import { hasLaterWorkStage } from './review-policy.js'

const normalize = value => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s`*_#~\-—–·.,，。；;：:!?！？、'"“”‘’()（）[\]【】{}「」《》<>/\\|]+/g, '')

const matchesText = (entry, requirement) => {
  const item = normalize(entry?.item)
  const target = normalize(requirement)
  if (item.length < 2 || target.length < 2) return false
  return item.includes(target) || target.includes(item)
}

// 契约房间里，本阶段的 clause id 就是这一轮要覆盖的要求。
export const coverageClausesOf = ({ room, stageIndex }) => {
  const contract = room?.plan?.contract ?? null
  if (contract === null || !Array.isArray(contract.outcomes)) return []
  const stage = room?.stages?.[stageIndex]
  const ids = Array.isArray(stage?.clauseIds) ? stage.clauseIds : []
  return contract.outcomes.filter(outcome => ids.length === 0 || ids.includes(outcome.id))
}

// 没有契约的老房间：最后一步之前只核本步交付物；最后一步把 plan.done 也核。
export const coverageRequirementsOf = ({ room, stageIndex }) => {
  const stage = room?.stages?.[stageIndex]
  const deliverable = typeof stage?.deliverable === 'string' ? stage.deliverable.trim() : ''
  const done = hasLaterWorkStage(room, stageIndex) || !Array.isArray(room?.plan?.done)
    ? []
    : room.plan.done
  const seen = new Set()
  const requirements = []
  for (const item of [deliverable, ...done]) {
    const text = typeof item === 'string' ? item.trim() : ''
    const key = normalize(text)
    if (text === '' || key === '' || seen.has(key)) continue
    seen.add(key)
    requirements.push(text)
  }
  return requirements
}

const covered = (entry, requirement) => {
  if (requirement !== null && typeof requirement === 'object') {
    return entry?.clauseId === requirement.id
  }
  return matchesText(entry, requirement)
}

// 返回没被覆盖的要求；契约要求返回 { id, statement }，老房间返回字符串。
export const coverageGapsOf = ({ coverage, requirements }) => (
  requirements.filter(requirement => (
    !Array.isArray(coverage) || !coverage.some(entry => covered(entry, requirement))
  ))
)
