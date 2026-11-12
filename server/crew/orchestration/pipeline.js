// 流水线：阶段串行，每段只派一个执行席位；规划师的 assignees 只作为选择依据。
export const id = 'pipeline'
export const name = '流水线'
export const description = '阶段串行，每段交给规划师提案里的执行席位；默认'
export const reviewGuidance = ''

export const planStage = ({ stage, workers }) => {
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(seat => workers.includes(seat))
    : []
  return {
    assignees: proposed.length > 0 ? proposed.slice(0, 1) : workers.slice(0, 1),
    parallel: false,
    note: proposed.length > 1 ? '流水线一次只派一个执行席位；其余席位留到后续阶段。' : '',
  }
}
