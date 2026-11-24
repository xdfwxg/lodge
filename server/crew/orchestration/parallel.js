// 并行扇出：所有执行官同时开工，由系统合并候选并统一验收。
export const id = 'parallel'
export const name = '并行扇出'
export const description = '提案里的执行官同时开工（默认全部），系统合并候选后统一验收；至少两个执行官'
export const reviewGuidance = ''

export const planStage = ({ stage, workers }) => {
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(member => workers.includes(member))
    : []
  const packages = Array.isArray(stage?.packages) ? stage.packages : []
  // 工作包和执行官一一对应：几个包就派几个人，顺序稳定，避免两个人抢同一块。
  const assignees = (packages.length > 1 ? (proposed.length > 0 ? proposed : workers).slice(0, packages.length) : (proposed.length > 0 ? proposed : [...workers]))
  return {
    assignees,
    parallel: assignees.length > 1,
    note: assignees.length > 1 ? '' : '并行模式需要至少两个执行官；当前按单成员执行。',
  }
}
