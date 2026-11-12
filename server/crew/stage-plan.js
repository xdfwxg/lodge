const FINAL_TITLE = '验收与结论'

const titleOf = value => (typeof value === 'string' ? value.trim().slice(0, 80) : '')

const normalize = (input, index) => {
  const title = titleOf(input?.title)
  const kind = input?.kind === 'decision' ? 'decision' : 'deliverable'
  const acceptance = typeof input?.acceptance === 'string' ? input.acceptance.trim().slice(0, 500) : ''
  const dependsOn = Array.isArray(input?.dependsOn)
    ? [...new Set(input.dependsOn.filter(item => Number.isInteger(item) && item >= 0 && item !== index))]
    : []
  if (title === '') return { error: '阶段标题不能为空' }
  if (kind === 'deliverable' && acceptance === '') return { error: `阶段「${title}」需要验收命令` }
  return { stage: { title, kind, ...(kind === 'deliverable' ? { acceptance } : { acceptance: undefined }), ...(dependsOn.length > 0 ? { dependsOn } : {}) } }
}

const finalIndex = stages => stages.findIndex(stage => stage.title === FINAL_TITLE)

export const editStages = (room, action, index, input) => {
  if (room.imported === true || room.demo === true) return { error: '这个房间不能编辑阶段' }
  if (room.state !== 'active' && room.state !== 'paused') return { error: '房间结束后不能编辑阶段' }
  const stages = (room.stages ?? []).map(stage => ({ ...stage }))
  if (stages.length === 0) return { error: '房间没有阶段' }
  const final = finalIndex(stages)

  if (action === 'add') {
    const normalized = normalize(input, stages.length - 1)
    if (normalized.error !== undefined) return normalized
    const insertAt = final >= 0 ? final : stages.length
    const dependsOn = normalized.stage.dependsOn ?? (insertAt > 0 ? [insertAt - 1] : [])
    stages.splice(insertAt, 0, {
      ...normalized.stage,
      state: 'pending',
      ...(dependsOn.length > 0 ? { dependsOn } : {}),
    })
    if (final >= 0) stages[final + 1].dependsOn = [final]
    return { stages, event: { type: 'stage.added', payload: { index: insertAt } } }
  }

  const at = Number(index)
  if (!Number.isInteger(at) || at < 0 || at >= stages.length) return { error: '没有这个阶段' }
  const target = stages[at]
  if (target.title === FINAL_TITLE) return { error: '验收与结论阶段由系统维护，不能编辑' }
  if (target.state !== 'pending') return { error: '只能编辑还没开始的阶段' }

  if (action === 'update') {
    const normalized = normalize(input, at)
    if (normalized.error !== undefined) return normalized
    stages[at] = { ...stages[at], ...normalized.stage, acceptance: normalized.stage.acceptance, state: 'pending' }
    return { stages, event: { type: 'stage.updated', payload: { index: at } } }
  }

  if (action === 'remove') {
    if (at === stages.length - 1) return { error: '不能移除最后一个阶段' }
    if (stages.some((stage, index) => index !== at && stage.title !== FINAL_TITLE && (stage.dependsOn ?? []).includes(at))) {
      return { error: '还有阶段依赖它，先改依赖再移除' }
    }
    stages.splice(at, 1)
    for (const stage of stages) {
      if (Array.isArray(stage.dependsOn)) {
        stage.dependsOn = stage.dependsOn
          .filter(item => item !== at)
          .map(item => (item > at ? item - 1 : item))
      }
    }
    const last = stages.length - 1
    if (last >= 0) {
      stages[last].dependsOn = [...new Set([...(stages[last].dependsOn ?? []), last - 1])]
        .filter(item => Number.isInteger(item) && item >= 0 && item < last)
    }
    return { stages, event: { type: 'stage.removed', payload: { index: at } } }
  }

  return { error: '未知的阶段操作' }
}
