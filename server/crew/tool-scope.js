// 工具面按角色裁剪：基座的 agents 协调面所有成员都隐藏；房间判定工具只给规划和验收。
// 同一个判定服务里再按角色分开：规划师不拿验收判定，验收员只拿 submit_verdict。
// 不能按名字禁原生工具：claudeAgent 不支持收窄 native:*，写了 native:SendMessage 会让整个回合起不来。
const VERIFIER_DENIED = [
  'mcp:lodge_gate:submit_decision',
  'mcp:lodge_gate:ask_decision',
  'mcp:lodge_gate:ask_question',
  'mcp:lodge_gate:rewind_stage',
  'mcp:lodge_gate:stop_round',
  'mcp:lodge_gate:resume_round',
]

export const toolScopeFor = member => {
  const kind = member?.roleKind ?? member?.role
  const deny = ['mcp:agents:*']
  if (kind === 'executor' || kind === 'participant') deny.push('mcp:lodge_gate:*')
  if (kind === 'planner') deny.push('mcp:lodge_gate:submit_verdict')
  if (kind === 'verifier') deny.push(...VERIFIER_DENIED)
  // 工作室要用户拍板时走 lodge_gate_ask_decision；基座的通用提问卡不在这里用。
  if (kind === 'planner' || kind === 'executor' || kind === 'verifier') deny.push('mcp:ogb:ask_user')
  return { deny }
}
