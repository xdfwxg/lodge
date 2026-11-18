// 工具面按角色裁剪：基座的 agents 协调面所有成员都隐藏；房间判定工具只给规划和验收。
export const toolScopeFor = member => {
  const kind = member?.roleKind ?? member?.role
  const deny = ['mcp:agents:*']
  if (kind === 'executor' || kind === 'participant') deny.push('mcp:lodge_gate:*')
  return { deny }
}
