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

// 只有支持按成员收窄工具面的驱动，才可以靠“直接做”省掉逐次审批；
// 其他驱动只能让审批桥继续裁决，否则角色权限会被绕过。
export const supportsToolScoping = engineId => engineId === 'pi'

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

// 原生工具面按成员权限派生：基座只拿到这份声明，没声明的成员不给工具。
// 放进身体设置的 nativeTools，只有 pi 这类支持收窄的驱动会读；别的驱动忽略它。
const NATIVE_TOOLS = Object.freeze({
  read: ['read', 'grep', 'find', 'ls'],
  write: ['write', 'edit'],
  exec: ['bash'],
})

export const nativeToolsFor = member => {
  const permissions = member?.permissions ?? {}
  return [
    ...(permissions.read === true ? NATIVE_TOOLS.read : []),
    ...(permissions.write === true ? NATIVE_TOOLS.write : []),
    ...(permissions.exec === true ? NATIVE_TOOLS.exec : []),
  ]
}

// 没有原生工具的成员（聊天参与者、主持人）走严格档：读只给白名单，HOME 是一次性的。
// 有工具的成员（规划/执行/验收）需要工具链，走标准档。边界跟着权限走，不另设开关。
// 例外只有一种：引擎在一次性 HOME 里起不来（codex 读真实 ~/.codex），那就只能标准档。
const NO_STRICT_PROFILE = new Set(['codex'])
export const executionProfileFor = (member, engine = '') => (
  nativeToolsFor(member).length === 0 && !NO_STRICT_PROFILE.has(engine) ? 'strict' : 'standard'
)
