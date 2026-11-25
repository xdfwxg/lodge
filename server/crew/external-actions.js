import { isGateToolName } from '../../shared/gate.js'
import { actionForTool } from '../../shared/tool-action.js'
import { APPROVAL_STATE } from '../../shared/states.js'

// 外部动作分类：只认命令语义，不猜模型意图。命中就停下等人，不按成员权限自动放行。
const RULES = [
  {
    kind: 'push',
    label: '推送到远端',
    pattern: /\bgit\b[^\n]*\bpush\b|\bgh\s+release\s+(?:create|upload)\b|\bnpm\s+publish\b|\b(?:pnpm|yarn)\s+publish\b|\bcargo\s+publish\b|\btwine\s+upload\b/i,
  },
  {
    kind: 'install',
    label: '安装或更新依赖',
    pattern: /\b(?:npm|pnpm|yarn)\b[^\n]*\b(?:i|install|add|ci)\b|\b(?:npx|bunx)\s+|\bpip3?\s+install\b|\bpython3?\s+-m\s+pip\s+install\b|\buv\s+(?:pip\s+)?(?:install|add)\b|\b(?:brew|apt|apt-get|dnf|yum|apk|choco|winget|scoop|conda|gem|cargo|go)\s+(?:install|add)\b|\b(?:dotnet|composer)\s+(?:add|require)\b|\bbundle\s+install\b/i,
  },
  {
    kind: 'delete',
    label: '删除文件',
    pattern: /(?:^|[;&|]\s*)(?:(?:env|command|xargs)\s+)*(?:rm|rmdir|unlink|shred|trash)\s|\b(?:del|rd)\s|\bfind\b[^\n]*-delete\b|\bgit\b[^\n]*\bclean\b|\bRemove-Item\b/i,
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
    pattern: /\b(?:curl|wget|ssh|scp|sftp|rsync|netcat|telnet|ping)\b|\bnc\s|\bgit\b[^\n]*\b(?:clone|fetch|pull|remote|ls-remote|submodule)\b|\bgh\s+|\b(?:docker|podman)\s+(?:push|pull|login|run)\b|\b(?:kubectl|helm|terraform|aws|gcloud|az)\s/i,
  },
]

const commandOf = card => {
  // 只有真正执行命令的卡片才按 shell 语义判断；写文件时正文里出现 `npm install`
  // 只是内容，不是要安装依赖。
  const shell = actionForTool(card?.tool) === 'exec' || card?.action === 'exec'
  if (!shell || typeof card?.subtitle !== 'string') return ''
  return card.subtitle.replace(/^\s*\$\s*/, '').replace(/\s+/g, ' ').trim()
}

const clip = (text, limit = 240) => (text.length > limit ? `${text.slice(0, limit)}…` : text)

const firstLineOf = text => String(text ?? '').split('\n').map(line => line.trim()).find(Boolean) ?? ''

const clipTarget = (text, limit = 60) => {
  const chars = [...String(text ?? '').trim()]
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : chars.join('')
}

const segmentAfter = (command, match) => (
  String(command ?? '')
    .slice((match.index ?? 0) + match[0].length)
    .split(/[;\n]|&&|\|\||\|/)[0] ?? ''
)

const tokensOf = text => (String(text ?? '').match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [])
  .map(token => token.replace(/^["']|["']$/g, ''))
  .filter(Boolean)

// 只取“人想知道的宾语”：跳过参数、重定向和变量。
const valuesOf = text => tokensOf(text).filter(token => !/^(?:-|[<>]|\d*>&?\d+$|\d+>$|\$)/.test(token))

const INSTALL = /\b(?:npm|pnpm|yarn|bun)\s+(?:i|install|add|ci)\b|\bpip3?\s+install\b|\bpython3?\s+-m\s+pip\s+install\b|\buv\s+(?:pip\s+)?(?:install|add)\b|\b(?:brew|apt|apt-get|dnf|yum|apk|choco|winget|scoop|conda|gem|cargo|go|dotnet|composer|bundle)\s+(?:install|add|require)\b/i

const installTargetOf = command => {
  const match = command.match(INSTALL)
  if (match === null) return ''
  if (/\bci\b/i.test(match[0])) return '项目依赖'
  const values = valuesOf(segmentAfter(command, match))
  if (values.length === 0) return '项目依赖'
  if (values[0] === '.' || values[0] === './') return '当前项目'
  return clipTarget(`${values.slice(0, 2).join('、')}${values.length > 2 ? ' 等' : ''}`)
}

const pushTargetOf = command => {
  const match = command.match(/\bgit\b[^\n]*\bpush\b/i)
  if (match === null) return ''
  return clipTarget(valuesOf(segmentAfter(command, match)).at(-1) ?? '远端')
}

const deleteTargetOf = command => {
  const match = command.match(/(?:^|[;&|]\s*)(?:(?:env|command|xargs)\s+)*(?:rm|rmdir|unlink|shred|trash)\s|\b(?:del|rd)\s|\bfind\b[^\n]*-delete\b|\bgit\b[^\n]*\bclean\b|\bRemove-Item\b/i)
  if (match === null) return ''
  if (/find|git\s+clean|Remove-Item/i.test(match[0])) return '文件'
  return clipTarget(valuesOf(segmentAfter(command, match))[0] ?? '文件')
}

const networkTargetOf = command => {
  const url = command.match(/https?:\/\/([^/\s"']+)/i)
  if (url !== null) return clipTarget(url[1])
  const host = command.match(/\b(?:ssh|scp|sftp|rsync|ping|telnet|nc|netcat)\s+(?:-\S+\s+)*([^\s;&|]+)/i)
  if (host !== null) return clipTarget(host[1])
  if (/\bgit\b[^\n]*\b(?:clone|fetch|pull|ls-remote|submodule)\b/i.test(command)) return '远端'
  return '外部服务'
}

// 卡片上真正要人判断的那一句：不是整条命令，是“它要动什么”。
const targetOf = (kind, command) => {
  if (kind === 'install') return installTargetOf(command) || '依赖'
  if (kind === 'push') return pushTargetOf(command) || '远端'
  if (kind === 'delete') return deleteTargetOf(command) || '文件'
  if (kind === 'message') return '房间外'
  if (kind === 'privilege') return '系统命令'
  if (kind === 'network') return networkTargetOf(command) || '外部服务'
  return clipTarget(firstLineOf(command))
}


// 网络类工具即使没有 shell 命令，也属于外部动作；当前仍由权限桥决定是否走到这里。
const TOOL_RULES = [
  { kind: 'network', label: '访问公开网页', pattern: /^mcp__chrome[-_]devtools__/i },
  { kind: 'network', label: '访问网络', pattern: /web|fetch|search|browser/i },
  { kind: 'message', label: '对外发送', pattern: /slack|mail|message|email|telegram|discord|webhook/i },
  { kind: 'network', label: '外部工具', pattern: /mcp/i },
]

export const externalAction = card => {
  const tool = String(card?.tool ?? '')
  // 房间内置判定工具不是外部服务，不在这里拦。
  if (isGateToolName(tool)) return null
  const command = commandOf(card)
  if (command !== '') {
    for (const rule of RULES) {
      if (rule.pattern.test(command)) {
        return { kind: rule.kind, label: rule.label, target: targetOf(rule.kind, command), summary: clip(command), command: clip(command, 8000) }
      }
    }
  }
  // 没有 shell 命令命中的工具仍要看工具本身：MCP/网页工具的 subtitle 是描述，不是本地命令。
  for (const rule of TOOL_RULES) {
    if (rule.pattern.test(tool)) {
      const target = rule.kind === 'network' ? networkTargetOf(String(card?.subtitle ?? '')) || '外部服务' : rule.kind === 'message' ? '房间外' : '外部工具'
      return { kind: rule.kind, label: rule.label, target, summary: clip(tool), command: '' }
    }
  }
  return null
}

export const pendingApprovals = room => (
  Array.isArray(room?.approvals) ? room.approvals.filter(item => item?.state === APPROVAL_STATE.pending) : []
)
