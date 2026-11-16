// 复核独立性只由实际厂商决定：执行和验收跨厂商才叫独立复核。
const kindOfRole = member => member.roleKind ?? member.role

export const independenceOf = ({ members, engines, instances }) => {
  const verifiers = members.filter(member => kindOfRole(member) === 'verifier')
  if (verifiers.length === 0) return 'human'
  const workers = members.filter(member => kindOfRole(member) === 'executor' || kindOfRole(member) === 'worker')
  const engineKind = id => instances.find(item => item.id === id)?.engine ?? id
  return verifiers.every(verifier => workers.every(worker => (
    engineKind(engines[worker.id]) !== engineKind(engines[verifier.id])
  )))
    ? 'vendor'
    : 'none'
}
