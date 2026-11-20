// 工具面按角色裁剪：基座的 agents 协调面所有成员都隐藏；房间判定工具只给规划和验收。
// 原生会话工具（给本机其他 Claude 会话发消息、列会话、开子代理）不在房间里用：
// 它们能跨房间投递任务，成员只该通过房间聊天和派活说话。
export const toolScopeFor = member => {
  const kind = member?.roleKind ?? member?.role
  const deny = ['mcp:agents:*', 'native:SendMessage', 'native:ListAgents', 'native:Agent', 'native:TaskStop']
  if (kind === 'executor' || kind === 'participant') deny.push('mcp:lodge_gate:*')
  return { deny }
}
