const activeStageIndex = room => room.stages.findIndex(stage => stage.state === 'active')

const latestForStage = (messages, kind, stage) => [...messages]
  .reverse()
  .find(message => message.kind === kind && (message.meta?.stage ?? 0) === stage)

// 注意力路由：只在房间真的卡在人这里时返回一个信号；不是未读数。
export const roomNeedsYou = (room, messages = []) => {
  if (room.state === 'paused') {
    if (room.pauseReason === 'budget') return { kind: 'budget', stage: null, label: '预算已用尽 · 等你处理' }
    return room.idle === true ? { kind: 'idle', stage: null, label: '等你说话' } : null
  }
  if (room.state !== 'active') return null
  const index = activeStageIndex(room)
  if (index < 0) return null
  const stage = room.stages[index]

  if (typeof room.openQuestion === 'string' && room.openQuestion.trim() !== '') {
    return { kind: 'question', stage: index, label: '等你回答' }
  }
  if (room.busy === true) return null
  if (stage.manual === true) {
    const manual = latestForStage(messages, 'evidence', index)
    if (manual?.meta?.kind !== 'manual') return null
    return { kind: 'decision', stage: index, label: '等你验收' }
  }
  if (stage.kind === 'decision') return { kind: 'decision', stage: index, label: '等你确认' }

  if (typeof stage.acceptance !== 'string' || stage.acceptance.trim() === '') {
    return { kind: 'setup', stage: index, label: '等你设验收命令' }
  }
  const dispatch = room.stageDispatch
  if (room.mergeConflict?.stage === index || (dispatch?.stage === index && dispatch?.conflict !== undefined && dispatch?.conflict !== null)) {
    return { kind: 'merge', stage: index, label: '合并冲突 · 等你处理' }
  }
  if (dispatch?.stage === index && dispatch?.stalled === true) {
    return { kind: 'parallel', stage: index, label: '并行执行没有产出 · 等你处理' }
  }
  if (dispatch?.stage === index && dispatch?.timedOut === true) {
    return { kind: 'parallel', stage: index, label: '并行执行超时 · 等你处理' }
  }
  const verdict = latestForStage(messages, 'verdict', index)
  if (verdict?.meta?.pass === true) return { kind: 'signoff', stage: index, label: '等你签字' }
  if (verdict !== undefined) return { kind: 'rework', stage: index, label: '验收退回 · 等你处理' }
  if (latestForStage(messages, 'evidence', index) !== undefined) {
    return (room.verifiers?.length ?? 0) > 0
      ? { kind: 'review', stage: index, label: '待复核' }
      : { kind: 'signoff', stage: index, label: '等你签字' }
  }
  return null
}
