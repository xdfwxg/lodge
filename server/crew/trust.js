import { commandEvidenceFor, reviewState, verifierIds } from './verifiers.js'

export const TRUST_LEVELS = ['observe', 'verify', 'auto']
export const DEFAULT_TRUST = 'verify'

export const trustLevelOf = room => (
  TRUST_LEVELS.includes(room?.trust) ? room.trust : DEFAULT_TRUST
)

const rank = level => TRUST_LEVELS.indexOf(level)

const provenDeliverable = (room, messages, index) => {
  const stage = room.stages?.[index]
  if (stage?.kind !== 'deliverable' || stage.state !== 'passed') return false
  const evidence = commandEvidenceFor(room, messages, index)
  if (evidence === undefined || evidence.meta?.exit !== 0) return false
  return reviewState({ room, messages, stageIndex: index }).state === 'pass'
}

// 升到 verify 需要至少一个已过阶段；升到 auto 需要独立验收和两条可复现的 PASS。
export const canPromoteTrust = (room, messages, target) => {
  if (!TRUST_LEVELS.includes(target)) return { ok: false, error: '未知信任级别' }
  const current = trustLevelOf(room)
  if (target === current) return { ok: false, error: `已经是 ${target}` }
  if (rank(target) < rank(current)) return { ok: true, demotion: true }
  if (room.demo === true) return { ok: false, error: '演示房间不能提升信任级别' }
  if (target === 'verify') {
    const passed = (room.stages ?? []).filter(stage => stage.state === 'passed').length
    return passed > 0
      ? { ok: true }
      : { ok: false, error: '至少有一个已通过阶段才能进入 verify' }
  }
  if (verifierIds(room).length === 0) {
    return { ok: false, error: 'auto 需要独立验收席位；当前房间没有 verifier' }
  }
  const proven = (room.stages ?? [])
    .map((stage, index) => ({ stage, index }))
    .filter(({ index }) => provenDeliverable(room, messages, index))
    .length
  return proven >= 2
    ? { ok: true }
    : { ok: false, error: 'auto 至少需要两个已通过、且有验收命令 PASS 的交付阶段' }
}
