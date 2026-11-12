// 对抗复核：派发仍是单席位，但验收席位被要求主动找反例，而不是确认作者自述。
export const id = 'critique'
export const name = '对抗复核'
export const description = '执行照常派发，验收席位先找反例和最可能失败的使用方式；不能只看作者自述'
export const reviewGuidance = '对抗复核：先找反例、边界输入和最可能失败的使用方式；没有可复现的问题再 PASS，不要因为作者说完成就放行。'

export const planStage = ({ stage, workers }) => {
  const proposed = Array.isArray(stage?.assignees)
    ? stage.assignees.filter(seat => workers.includes(seat))
    : []
  return {
    assignees: proposed.length > 0 ? proposed.slice(0, 1) : workers.slice(0, 1),
    parallel: false,
    note: '',
  }
}
