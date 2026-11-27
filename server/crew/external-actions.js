import { isGateToolName } from '../../shared/gate.js'
import { actionForTool } from '../../shared/tool-action.js'
import { realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, resolve, sep } from 'node:path'
import { APPROVAL_STATE } from '../../shared/states.js'

// 删除命令的唯一定义：门禁与取目标共用一份；换行和括号都是命令位置。
const DELETE_PATTERN = /(?:^|[;&|(\n{]\s*)(?:(?:env|command|xargs)\s+)*(?:rm|rmdir|unlink|shred|trash)\s|\b(?:del|rd)\s|\bfind\b[^\n]*-delete\b|\bgit\b[^\n]*\bclean\b|\bRemove-Item\b/i

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
    pattern: DELETE_PATTERN,
  },
  {
    kind: 'message',
    label: '对外发送',
    pattern: /\b(?:sendmail|mail|slack|twilio|telegram|discord)\b|\bgh\s+(?:pr|issue)\s+comment\b|\bosascript\b/i,
  },
  {
    kind: 'privilege',
    label: '提权执行',
    pattern: /(?:^|[;&|\n]\s*)(?:sudo|doas|su|runas)\s|\bStart-Process\b[^\n]*-Verb\s+RunAs\b/i,
  },
  {
    kind: 'network',
    label: '访问网络或远端',
    pattern: /\b(?:curl|wget|ssh|scp|sftp|rsync|netcat|telnet|ping)\b|\bnc\s|\bgit\b[^\n]*\b(?:clone|fetch|pull|remote|ls-remote|submodule)\b|\bgh\s+|\b(?:docker|podman)\s+(?:push|pull|login|run)\b|\b(?:kubectl|helm|terraform|aws|gcloud|az)\s/i,
  },
]

// rsync 只在有远端目标时才算网络动作：两边都是本地路径的复制不该占人一次确认。
// 远端形态认这几种：user@host:path、host:path、-e ssh / --rsh。
const localRsyncOnly = command => {
  const tokens = tokensOf(command)
  const remote = tokens.some(token => (
    /^[A-Za-z0-9._-]+@/.test(token) ||
    (/^[^/]+:/.test(token) && !/^[A-Za-z]:[\\/]/.test(token)) ||
    token === 'ssh' ||
    token === 'rsh' ||
    /^--rsh(?:=|$)/.test(token)
  ))
  return !remote
}

// 除了 rsync 之外明确属于网络的写法：命令里只要有它们，就不能因为 rsync 是本地而整条放行。
const HARD_NETWORK = /\b(?:curl|wget|scp|sftp|netcat|telnet|ping)\b|\bssh\b|\bnc\s|\bgit\b[^\n]*\b(?:clone|fetch|pull|remote|ls-remote|submodule)\b|\bgh\s+|\b(?:docker|podman)\s+(?:push|pull|login|run)\b|\b(?:kubectl|helm|terraform|aws|gcloud|az)\s/i

const commandOf = card => {
  // 只有真正执行命令的卡片才按 shell 语义判断；写文件时正文里出现 `npm install`
  // 只是内容，不是要安装依赖。
  const shell = actionForTool(card?.tool) === 'exec' || card?.action === 'exec'
  if (!shell || typeof card?.subtitle !== 'string') return ''
  // 只压空格和制表符：换行是命令分隔符，压掉会把两条命令粘成一条，判断跟着错。
  return card.subtitle.replace(/^\s*\$\s*/, '').replace(/[^\S\n]+/g, ' ').trim()
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
  const match = command.match(DELETE_PATTERN)
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


// 删除是否只落在成员本来就能写的地方（工作副本、临时目录）。
// 沙箱已经把这之外挡死了；这里只处理审批，不把“验证命令清理自己的临时目录”当外部删除。
const WRAPPERS = new Set(['env', 'command', 'nohup', 'xargs', 'sudo', 'doas'])
const DELETE_COMMANDS = new Set(['rm', 'rmdir', 'unlink', 'shred', 'trash', 'del', 'rd'])

const pathForms = value => {
  const full = resolve(value)
  try {
    return [...new Set([full, realpathSync.native(full)])]
  } catch {
    return [full]
  }
}

const insideRoots = (value, roots) => {
  if (typeof value !== 'string' || value === '' || value === '~' || value.startsWith('~/')) return false
  const forms = pathForms(value)
  return roots.some(root => pathForms(root).some(base => forms.some(form => (
    form === base || form.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
  ))))
}

// 按 shell 的分隔符切段，但引号里的 ; | && || 不断句：
// 命令里嵌一段 JS（'|' 会出现在字符串里）时，按正则切会把 rm 裹进一个假引号里，
// 于是“删自己的临时目录”被当成外部删除，白占人一次确认。
const splitSegments = text => {
  const out = []
  let current = ''
  let quote = ''
  const source = String(text ?? '')
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote !== '') {
      current += char
      if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }
    if (char === '\\') {
      current += char
      if (index + 1 < source.length) {
        current += source[index + 1]
        index += 1
      }
      continue
    }
    if (char === '&') {
      // 单个 & 是后台执行，也是分隔；&& 只是同一种分隔的另一种写法。
      out.push(current)
      current = ''
      if (source[index + 1] === '&') index += 1
      continue
    }
    if (char === ';' || char === '|' || char === '\n') {
      out.push(current)
      current = ''
      if ((char === '|' || char === ';') && source[index + 1] === char) index += 1
      continue
    }
    current += char
  }
  out.push(current)
  return out
}

const shellTokens = text => (String(text).match(/"[^"]*"|'[^']*'|\S+/g) ?? [])
  .map(token => token.replace(/^["']|["']$/g, ''))

// 保守解析：任何一处删到无法确认在可写范围内，就仍按外部删除处理。
const deleteStaysWritable = (command, { cwd = '', writable = [] } = {}) => {
  if (writable.length === 0) return false
  const segments = splitSegments(command)
  const tempVars = new Set()
  const varPaths = new Map()
  let current = cwd === '' ? '' : resolve(cwd)
  let sawDelete = false
  let inside = true
  const resolveTarget = value => {
    if (isAbsolute(value)) return value
    return current === '' ? '' : resolve(current, value)
  }
  for (const segment of segments) {
    const tokens = shellTokens(segment.trim())
    if (tokens.length === 0) continue
    for (const token of tokens) {
      const assignment = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(token)
      if (assignment === null) continue
      const [, name, value] = assignment
      if (/\$\(\s*mktemp\b/.test(value)) {
        tempVars.add(name)
        varPaths.delete(name)
      } else if (value !== '' && !value.includes('$')) {
        varPaths.set(name, value)
        tempVars.delete(name)
      }
    }
    const cdAt = tokens.findIndex(token => token === 'cd')
    if (cdAt >= 0 && tokens[cdAt + 1] !== undefined && !tokens[cdAt + 1].startsWith('-')) {
      const target = tokens[cdAt + 1]
      current = target.startsWith('~') ? '' : resolveTarget(target)
    }
    for (let index = 0; index < tokens.length; index += 1) {
      // 段里可能在引号或括号中间被切开：`(rm x)` 的首 token 是 `(rm`，先剥掉它前面的括号。
      const name = tokens[index].replace(/^[({]+/, '').split('/').pop()
      if (!DELETE_COMMANDS.has(name)) continue
      // 逗引号碎片不该让后面真正的 rm 被漏掉；但只认“命令位”上的 rm：
      // 行首、包装命令、或者紧跟分隔符（`; rm`、`); rm`、`do rm`）——`echo rm` 这类参数不算。
      let prev = index - 1
      while (prev >= 0 && /^["'`]+$/.test(tokens[prev])) prev -= 1
      const previous = prev < 0 ? '' : tokens[prev]
      const atCommandPosition = prev < 0 ||
        WRAPPERS.has(previous.split('/').pop()) ||
        /[;(){}&|]$/.test(previous) ||
        /^(?:do|then|else)$/.test(previous)
      if (!atCommandPosition) continue
      sawDelete = true
      for (const arg of tokens.slice(index + 1)) {
        if (arg.startsWith('-') || arg === '--' || /^[A-Za-z_][A-Za-z0-9_]*=/.test(arg)) continue
        const value = arg.trim()
        if (value === '') continue
        // ~ 是家目录，不是当前目录下一个叫 "~" 的文件夹；解析前就按外部处理。
        if (value === '~' || value.startsWith('~/')) {
          inside = false
          continue
        }
        const variable = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(value)
        if (variable !== null) {
          const variableName = variable[1]
          if (tempVars.has(variableName)) continue
          const mapped = varPaths.get(variableName)
          if (mapped === undefined || !insideRoots(resolveTarget(mapped), writable)) inside = false
          continue
        }
        if (!insideRoots(resolveTarget(value), writable)) inside = false
      }
    }
    if (tokens.includes('-delete')) {
      const findAt = tokens.findIndex(token => token.split('/').pop() === 'find')
      if (findAt >= 0) {
        sawDelete = true
        for (const arg of tokens.slice(findAt + 1)) {
          if (arg.startsWith('-') || arg === '(' || arg === '!' || arg === '\(') break
          if (!insideRoots(resolveTarget(arg), writable)) inside = false
        }
      }
    }
  }
  return sawDelete && inside
}

export const externalAction = (card, { cwd = '', writable = [] } = {}) => {
  const tool = String(card?.tool ?? '')
  // 房间内置判定工具不是外部服务，不在这里拦。
  if (isGateToolName(tool)) return null
  const command = commandOf(card)
  if (command !== '') {
    for (const rule of RULES) {
      if (!rule.pattern.test(command)) continue
      // 本地 rsync 不是外部动作；远端形态照旧停下来问。
      if (rule.kind === 'network' && /\brsync\b/.test(command) && !HARD_NETWORK.test(command) && localRsyncOnly(command)) continue
      // 副本/临时目录内的删除由沙箱兜底，不占人类的一次确认；还有别的外部动作就继续往下看。
      if (rule.kind === 'delete' && deleteStaysWritable(command, { cwd, writable })) continue
      return { kind: rule.kind, label: rule.label, target: targetOf(rule.kind, command), summary: clip(command), command: clip(command, 8000) }
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
