export const id = 'task'
export const name = '任务房'
export const description = '拆目标、派活、验收、交付；默认形态'
export const defaultVerify = 'test'
export const defaultSeats = null
export const autoStart = 'stage'

export const normalize = ({ verify, acceptance }) => ({ verify, acceptance })

export const buildStages = ({ title, plan, verify, acceptance, align }) => {
  const delivery = {
    title,
    kind: verify === 'test' ? 'deliverable' : 'decision',
    ...(verify === 'test' ? { acceptance } : { manual: true }),
  }
  const planned = Array.isArray(plan?.stages) ? plan.stages : []
  const openingGate = planned.length > 0 &&
    planned[0].kind === 'decision' &&
    /确认|对齐/.test(planned[0].title ?? '')
  const firstActive = openingGate ? 1 : 0
  const work = planned.length > 0
    ? planned.map((stage, index) => ({
      title: stage.title,
      kind: stage.kind,
      ...(stage.manual === true ? { manual: true } : {}),
      ...(stage.acceptance ? { acceptance: stage.acceptance } : {}),
      state: index === firstActive ? 'active' : index < firstActive ? 'passed' : 'pending',
    }))
    : [{ ...delivery, state: align && plan === null ? 'pending' : 'active' }]
  const stages = [
    ...(align ? [{ title: '目标对齐', kind: 'decision', state: plan !== null ? 'passed' : 'active' }] : []),
    ...work,
    { title: '验收与结论', kind: 'decision', state: 'pending' },
  ]
  if (!stages.some(stage => stage.state === 'active')) {
    const next = stages.find(stage => stage.state === 'pending')
    if (next !== undefined) next.state = 'active'
  }
  stages[stages.length - 1].dependsOn = [stages.length - 2]
  return {
    stages,
    messages: openingGate ? ['开工卡已确认；重复的确认阶段已自动通过，直接进入下一步。'] : [],
  }
}
