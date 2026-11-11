// 外部动作分类：只认命令语义，不猜模型意图。命中就停下等人，不按席位权限自动放行。
const RULES = [
  {
    kind: 'push',
    label: '推送到远端',
    pattern: /\bgit\s+(?:push|send-email)\b|\bgh\s+release\s+(?:create|upload)\b|\bnpm\s+publish\b|\b(?:pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i,
  },
  {
    kind: 'install',
    label: '安装或更新依赖',
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:i|install|add|ci)\b|\b(?:npx|bunx)\s+|\bpip3?\s+install\b|\bpython3?\s+-m\s+pip\s+install\b|\buv\s+(?:pip\s+)?(?:install|add)\b|\b(?:brew|apt|apt-get|dnf|yum|apk|choco|winget|scoop|conda|gem|cargo|go)\s+(?:install|add)\b|\b(?:dotnet|composer)\s+(?:add|require)\b|\bbundle\s+install\b/i,
  },
  {
    kind: 'delete',
    label: '删除文件',
    pattern: /(?:^|[;&|]\s*)(?:rm|rmdir|unlink|shred|trash|del|rd)\s|\bfind\b[^\n]*-delete\b|\bgit\s+clean\b|\bRemove-Item\b/i,
  },
  {
    kind: 'message',
    label: '对外发送',
    pattern: /\b(?:sendmail|mail|slack|twilio|telegram|discord)\b|\bgh\s+(?:pr|issue)\s+comment\b|\bosascript\b/i,
  },
  {
    kind: 'privilege',
    label: '提权执行',
    pattern: /(?:^|[;&|]\s*)(?:sudo|doas|su|runas)\s|\bStart-Process\b[^\n]*-Verb\s+RunAs\b/i,
  },
  {
    kind: 'network',
    label: '访问网络或远端',
    pattern: /\b(?:curl|wget|ssh|scp|sftp|rsync|netcat|telnet|ping)\b|\bnc\s|\bgit\s+(?:clone|fetch|pull|remote|ls-remote|submodule)\b|\bgh\s+|\b(?:docker|podman)\s+(?:push|pull|login|run)\b|\b(?:kubectl|helm|terraform|aws|gcloud|az)\s/i,
  },
]

const commandOf = card => {
  if (typeof card?.subtitle !== 'string') return ''
  return card.subtitle.replace(/^\s*\$\s*/, '').replace(/\s+/g, ' ').trim()
}

const clip = (text, limit = 240) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

// 网络类工具即使没有 shell 命令，也属于外部动作；当前仍由权限桥决定是否走到这里。
const TOOL_RULES = [
  { kind: 'network', label: '访问网络', pattern: /web|fetch|search|browser/i },
  { kind: 'message', label: '对外发送', pattern: /slack|mail|message|email|telegram|discord|webhook/i },
]

export const externalAction = card => {
  const command = commandOf(card)
  if (command !== '') {
    for (const rule of RULES) {
      if (rule.pattern.test(command)) {
        return { kind: rule.kind, label: rule.label, summary: clip(command) }
      }
    }
    return null
  }
  const tool = String(card?.tool ?? '')
  for (const rule of TOOL_RULES) {
    if (rule.pattern.test(tool)) return { kind: rule.kind, label: rule.label, summary: clip(tool) }
  }
  return null
}

export const pendingApprovals = room => (
  Array.isArray(room?.approvals) ? room.approvals.filter(item => item?.state === 'pending') : []
)
