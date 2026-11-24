export const studioConstraints = ({
  plan,
  verify,
  acceptance,
  verifiers,
  independence,
}) => [
  '交接由系统投递：写清下一步做什么、怎么算完成、交给谁（写名字，不带 @）',
  plan?.stages?.length > 0
    ? `阶段验收：${plan.stages.filter(stage => stage.acceptance).map(stage => `${stage.title} → ${stage.acceptance}`).join('；') || '人确认'}`
    : verify === 'test' ? `验收命令：${acceptance}` : '验收方式：人确认，不跑命令',
  ...(verifiers.length === 0
    ? ['这个房间没有独立验收员，由你凭证据确认']
    : [independence === 'vendor'
      ? '执行与验收已绑定不同厂商；验收员在独立副本里复核'
      : '当前只有同一家模型可用：复核和执行来自同一家，独立复核会打折']),
]

const ENGINE_LABEL = {
  'claude-cli': 'Claude',
  'codex-cli': 'Codex',
  'grok-cli': 'Grok',
  'kimi-cli': 'Kimi',
  'qwen-cli': '通义千问',
  'deepseek-cli': 'DeepSeek',
  'pi-cli': 'Pi',
  'gemini-cli': 'Gemini',
  claude: 'Claude',
  codex: 'Codex',
  grok: 'Grok',
  kimi: 'Kimi',
  qwen: '通义千问',
  deepseek: 'DeepSeek',
  pi: 'Pi',
  gemini: 'Gemini',
}

// 驱动不支持权限复核时，外部动作不会停下来等人；在房间里把这件事说清楚。
const approvalNotice = (room, approvalGates = {}) => {
  const rows = (room?.members ?? []).filter(member => (
    approvalGates[member.id] === false && member.permissions?.exec === true
  ))
  if (rows.length === 0) return null
  const names = rows.map(member => member.name ?? member.role).join('、')
  const engines = [...new Set(rows
    .map(member => member.body?.engine)
    .filter(id => typeof id === 'string' && id !== '')
    .map(id => ENGINE_LABEL[id] ?? id))]
  const engineText = engines.length === 0 ? '当前模型' : engines.join('、')
  return `${names}用的 ${engineText} 不会先问你：联网、安装、推送这类对外操作会直接执行。`
}

export const initialMessages = ({ room, workspaces, engineFallbacks, approvalGates = {} }) => {
  // 时间线只保留会改变用户判断的信息；建房仪式、分支、约束快照、MCP 说明都
  // 能从房间字段和交付卡里查到，不再复述。
  const messages = []
  // 规划师的排期要像一条消息说出来，而不是只藏在岛上。
  // 计划是规划师自己在方案里说的话，平台不再替它复述步骤。
  const prose = typeof room?.plan?.prose === 'string' ? room.plan.prose.trim() : ''
  if (prose !== '') {
    const lead = room?.leadMemberId
      ?? (room?.members ?? []).find(member => member.role === 'lead' || member.roleKind === 'planner')?.id
    messages.push({
      kind: 'plan',
      ...(typeof lead === 'string' && lead !== '' ? { authorId: lead } : {}),
      text: prose,
    })
  }
  const label = { lead: '规划师', planner: '规划师', worker: '执行官', executor: '执行官', verifier: '验收员' }
  const envWarnings = Object.entries(workspaces.environment ?? {})
    .flatMap(([member, env]) => (env.warnings ?? []).map(text => `${label[member] ?? member}: ${text}`))
  if (envWarnings.length > 0) messages.push({ kind: 'system', text: `工作文件夹同步警告：${envWarnings.join('；')}` })
  if (Object.keys(engineFallbacks).length > 0) {
    const text = Object.entries(engineFallbacks)
      .map(([member, item]) => `${label[member] ?? member} 没能用上 ${ENGINE_LABEL[item.requested] ?? item.requested}，实际跑的是 ${ENGINE_LABEL[item.actual] ?? item.actual}`)
      .join('；')
    messages.push({
      kind: 'system',
      text: room?.independence === 'vendor'
        ? `${text}。验收仍由另一家模型独立复核，交付卡会按实际模型标注。`
        : `${text}。这次不是独立复核，验收卡会按实际模型标注。`,
    })
  }
  const notice = approvalNotice(room, approvalGates)
  if (notice !== null) messages.push({ kind: 'system', text: notice })
  return messages
}
