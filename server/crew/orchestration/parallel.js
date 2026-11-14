// 并行扇出：所有执行席位同时开工，由系统合并候选并统一验收。
export const id = 'parallel'
export const name = '并行扇出'
export const description = '提案里的执行席位同时开工（默认全部），系统合并候选后统一验收；至少两个执行席位'
export const reviewGuidance = ''

export const planStage = ({ stage, workers }) => {
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(seat => workers.includes(seat))
    : []
  const assignees = proposed.length > 0 ? proposed : [...workers]
  return {
    assignees,
    parallel: assignees.length > 1,
    note: assignees.length > 1 ? '' : '并行模式需要至少两个执行席位；当前按单席位执行。',
  }
}
