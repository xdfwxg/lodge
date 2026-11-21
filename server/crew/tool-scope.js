// 工具面按角色裁剪：基座的 agents 协调面所有成员都隐藏；房间判定工具只给规划和验收。
// 不能按名字禁原生工具：claudeAgent 不支持收窄 native:*，写了 native:SendMessage 会让整个回合起不来。
export const toolScopeFor = member => {
  const kind = member?.roleKind ?? member?.role
  const deny = ['mcp:agents:*']
  if (kind === 'executor' || kind === 'participant') deny.push('mcp:lodge_gate:*')
  return { deny }
}
