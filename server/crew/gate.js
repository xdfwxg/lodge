// 独立守门检查：只看动作、席位角色与房间约束，不看执行席位的对话。
// 它给建议，不替人做最终决定；审批权仍在人手里。
const DENY_PATTERNS = [
  { pattern: /(?:^|[;&|]\s*)(?:sudo|doas|su|runas)\s|\bStart-Process\b[^\n]*-Verb\s+RunAs\b/i, reason: '提权命令' },
  { pattern: /\brm\s+-[a-z]*[rf]|\bgit\s+clean\b|\bfind\b[^\n]*-delete\b|\bRemove-Item\b/i, reason: '删除文件或清理工作区' },
  { pattern: /\bgit\s+push\b[^\n]*(?:--force|-f\b)|\bgit\s+reset\s+--hard\b/i, reason: '强制改写远端或本地历史' },
  { pattern: /\bdrop\s+(?:table|database)\b|\btruncate\s+table\b/i, reason: '销毁数据库对象' },
]

const REVIEW_PATTERNS = [
  { pattern: /\bgit\s+push\b|\bnpm\s+publish\b|\b(?:pnpm|yarn|cargo)\s+publish\b|\bgh\s+release\b/i, reason: '发布或推送远端' },
  { pattern: /\b(?:npm|pnpm|yarn)\s+(?:i|install|add|ci)\b|\bpip3?\s+install\b|\bbrew\s+install\b/i, reason: '安装依赖' },
  { pattern: /\b(?:curl|wget|ssh|scp|sftp|rsync|nc|netcat|telnet)\b|\bgh\s+/i, reason: '网络或远端访问' },
  { pattern: /\b(?:sendmail|mail|slack|twilio|telegram|discord)\b|\bgh\s+(?:pr|issue)\s+comment\b/i, reason: '对外发送消息' },
]

const constrains = (room, kind) => {
  const text = [
    ...(Array.isArray(room?.constraints) ? room.constraints : []),
    ...(typeof room?.projectConstraints?.content === 'string' ? [room.projectConstraints.content] : []),
  ].join('\n')
  if (kind === 'push' && /(不|禁止|不要).{0,8}(push|推送)|no push/i.test(text)) return '房间约束禁止 push'
  if (kind === 'network' && /(不|禁止|不要).{0,8}(联网|网络)|no network/i.test(text)) return '房间约束禁止联网'
  if (kind === 'install' && /(不|禁止|不要).{0,8}(安装|依赖)|no install/i.test(text)) return '房间约束禁止安装依赖'
  return null
}

export const reviewExternalAction = ({ approval, room }) => {
  const command = typeof approval?.summary === 'string' ? approval.summary : ''
  const role = room?.seatSpecs?.find(seat => seat.id === approval?.seat)?.role
  const reasons = []
  let risk = 'low'
  let decision = 'allow'

  if (role === 'lead' || role === 'verifier') {
    decision = 'deny'
    risk = 'high'
    reasons.push(`${role === 'lead' ? '队长' : '验收席位'}不应产生外部写入`)
  }
  for (const rule of DENY_PATTERNS) {
    if (rule.pattern.test(command)) {
      decision = 'deny'
      risk = 'high'
      reasons.push(rule.reason)
    }
  }
  for (const rule of REVIEW_PATTERNS) {
    if (rule.pattern.test(command)) {
      if (decision !== 'deny') decision = 'review'
      if (risk === 'low') risk = 'medium'
      reasons.push(rule.reason)
    }
  }
  const constraint = constrains(room, approval?.kind)
  if (constraint !== null) {
    decision = 'deny'
    risk = 'high'
    reasons.push(constraint)
  }
  return {
    decision,
    risk,
    reasons: [...new Set(reasons)],
    context: 'independent',
    basis: '命令语义 + 席位角色 + 房间约束，不读执行席位对话',
    at: Date.now(),
  }
}
