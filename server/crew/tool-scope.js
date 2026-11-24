// 工具面按角色裁剪：基座的 agents 协调面所有成员都隐藏；房间判定工具只给规划和验收。
// 同一个判定服务里再按角色分开：规划师不拿验收判定，验收员只拿 submit_verdict。
// 不能按名字禁原生工具：claudeAgent 不支持收窄 native:*，写了 native:SendMessage 会让整个回合起不来。
const GATE_TOOLS = [
  'submit_verdict',
  'submit_decision',
  'submit_plan',
  'adjust_member_model',
  'ask_decision',
  'ask_question',
  'rewind_stage',
  'stop_round',
  'resume_round',
]
const GATE_DENIED_BY_ROLE = Object.freeze({
  planner: ['submit_verdict'],
  verifier: GATE_TOOLS.filter(tool => tool !== 'submit_verdict'),
  executor: ['*'],
  participant: ['*'],
})

// 权限桥和工具面共用同一份角色规则；空工具名或别的 MCP 一律拒绝。
export const gateToolAllowed = (member, tool) => {
  const kind = member?.roleKind ?? member?.role
  const denied = GATE_DENIED_BY_ROLE[kind]
  if (denied === undefined || denied.includes('*')) return false
  const text = String(tool ?? '')
  const name = GATE_TOOLS.find(item => [
    item,
    `mcp:lodge_gate:${item}`,
    `mcp__lodge_gate__${item}`,
    `lodge_gate:${item}`,
    `lodge_gate_${item}`,
    `lodge_gate.${item}`,
  ].includes(text))
  return name !== undefined && !denied.includes(name)
}

export const toolScopeFor = member => {
  const kind = member?.roleKind ?? member?.role
  const deny = ['mcp:agents:*']
  const denied = GATE_DENIED_BY_ROLE[kind]
  if (denied !== undefined) {
    deny.push(...denied.map(tool => `mcp:lodge_gate:${tool}`))
  }
  // 工作室要用户拍板时走 lodge_gate_ask_decision；基座的通用提问卡不在这里用。
  if (kind === 'planner' || kind === 'executor' || kind === 'verifier') deny.push('mcp:ogb:ask_user')
  return { deny }
}
