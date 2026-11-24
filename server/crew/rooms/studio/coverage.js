// PASS 的覆盖表必须对得上这一阶段真正要交的东西：本步交付物，最后一步还要覆盖整轮目标。
import { hasLaterWorkStage } from './review-policy.js'

const normalize = value => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/[\s`*_#~\-—–·.,，。；;：:!?！？、'"“”‘’()（）[\]【】{}「」《》<>/\\|]+/g, '')

const matches = (entry, requirement) => {
  const item = normalize(entry?.item)
  const target = normalize(requirement)
  if (item.length < 2 || target.length < 2) return false
  return item.includes(target) || target.includes(item)
}

// 最后一步之前只核本步交付物；最后一步把 plan.done 的每条也一起核。
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

// 返回没被覆盖的要求；review 只负责把这张缺口清单还给验收员。
export const coverageGapsOf = ({ coverage, requirements }) => (
  requirements.filter(requirement => (
    !Array.isArray(coverage) || !coverage.some(entry => matches(entry, requirement))
  ))
)
