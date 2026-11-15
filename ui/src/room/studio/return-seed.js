// 工作室 → 聊天室只带结果摘要、状态和待确认问题；不搬房间过程。
export const returnToChatSeed = room => {
  const delivery = room?.delivery
  if (delivery === null || delivery === undefined) return null
  const commands = delivery.commands ?? []
  const passed = commands.filter(command => command.exit === 0).length
  const stages = delivery.stages ?? []
  const done = stages.filter(stage => stage.state === 'passed').length
  const changed = delivery.changedFiles?.length ?? 0
  return {
    goal: `评审这次交付：${delivery.name}`,
    conclusion: [
      `目标：${delivery.goal}`,
      `完成：${done}/${stages.length} 步`,
      `检查：${commands.length > 0 ? `${passed}/${commands.length} 项通过` : '人工验收'}`,
      `交付：${changed} 个文件`,
      '待确认：这份结果还需要补什么，或者可以直接用？',
    ].join('\n'),
    label: '这次交付',
    sourceName: delivery.name,
  }
}
