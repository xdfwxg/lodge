// 基座注入给 pi 的扩展，只做两件宿主该管的事：
// 1) 把本回合的 MCP 服务器注册进来（定义来自 LODGE_MCP_CONFIG）；
// 2) 按成员的审批级别拦工具调用：只读直接放行，会改东西或打到外部的一律先问人。
// 房间判定工具（lodge_gate）是契约的一部分，不算外部动作。
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

// 基座在发提示词前等这个标记：扩展没加载，工具边界就不存在，回合不跑。
if (typeof process.env.LODGE_EXTENSION_MARKER === 'string' && process.env.LODGE_EXTENSION_MARKER !== '') {
  try {
    writeFileSync(process.env.LODGE_EXTENSION_MARKER, 'ok')
  } catch {}
}

const READ_ONLY = new Set(
  String(process.env.LODGE_READ_TOOLS ?? 'read,grep,find,ls')
    .split(',')
    .map(name => name.trim())
    .filter(Boolean),
)
// 只问外部和不可逆的动作：联网、装包、发布、提权。git 的远端动作不在这里问：
// 出网本来就由基座代理按主机放行，仓库域名进不去；本机 clone/worktree 是正常复核动作。
// 本机的读写和执行由沙箱兜底（写只落在成员副本），不再逐条问——
// 否则验收员跑一条 `ls` 也要等人，没人看着的房间一定停住。
const RISKY_COMMAND = /(^|[\s;&|(`])(curl|wget|nc|ncat|telnet|ssh|scp|sftp|rsync|ftp|dig|nslookup|sudo|su|chmod|chown|launchctl|defaults|crontab|shutdown|reboot|killall)\b|(^|[\s;&|(`])(npm|pnpm|yarn|bun)\s+(i|install|add|update|upgrade|ci|publish)\b|(^|[\s;&|(`])(pip|pip3|gem|cargo|brew)\s+(install|add|upgrade)\b|(^|[\s;&|(`])(docker|kubectl|helm|terraform|gh)\s+\w+|https?:\/\//i
const riskyCommand = input => RISKY_COMMAND.test(String(input?.command ?? ''))
// 写在自己工作副本里的文件不问人：副本就是这次交付的现场，边界由沙箱和写包对账兜底。
// 从进程自己的工作目录算，所以相对路径和绝对路径都按同一条规则判断。
const insideWorkspace = input => {
  const value = input !== null && typeof input === 'object' ? input : {}
  const target = typeof value.path === 'string'
    ? value.path
    : typeof value.file_path === 'string' ? value.file_path : ''
  if (target === '') return false
  const root = process.cwd()
  const full = resolve(root, target)
  return full === root || full.startsWith(root + sep)
}
const ASK = process.env.LODGE_APPROVAL === 'ask'
// 工作区选择本身就是同意：房间选“这台电脑”之后，电脑提供方的工具不再逐条问。
const AUTO_SERVERS = String(process.env.LODGE_AUTO_SERVERS ?? '')
  .split(',')
  .map(name => name.trim())
  .filter(Boolean)
const autoServer = name => AUTO_SERVERS.some(server => name.startsWith(`mcp__${server}__`))
// 房间明确禁止的工具：同样不藏，调用时拒绝并说明原因。
const DENIED = String(process.env.LODGE_DENIED_TOOLS ?? '')
  .split(',')
  .map(name => name.trim())
  .filter(Boolean)
const denied = name => DENIED.some(pattern => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name))
const CONTRACT_TOOL = 'mcp__lodge_gate__'
const SKILL_TOOL = 'use_skill'
// 基座网关的读回工具：读的是这一回合自己落盘的结果，不是外部动作，不问人。
const GATE_READ_TOOL = 'lodge_mcp_read'
// 技能正文在回合目录里：系统提示只列名字和一句话，读全文由 use_skill 按需取。
const SKILLS_DIR = process.env.LODGE_SKILLS_DIR ?? ''
// pi 会把 typebox 映射给它自己的副本；直接跑（单测、别的宿主）时没有它，退回普通 JSON Schema。
const typebox = await import('typebox').then(mod => mod.Type).catch(() => null)
const skillParameters = typebox === null
  ? { type: 'object', properties: { name: { type: 'string', description: '技能名，来自系统提示里的清单' } }, required: ['name'] }
  : typebox.Object({ name: typebox.String({ description: '技能名，来自系统提示里的清单' }) })
// 工具面不藏：pi 的全部工具都可见，但成员只能用房间授过权的那些。
// 没设这份名单（老基座或单测）时不拦，保持“不额外限制”。
const GRANTED = process.env.LODGE_GRANTED_TOOLS === undefined
  ? null
  : String(process.env.LODGE_GRANTED_TOOLS)
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
const granted = name => GRANTED === null
  || GRANTED.some(pattern => (pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : pattern === name))

// 审批卡要带的是“要动什么”，不是一串 JSON：
// 命令行给命令本身，写文件给路径，其余给截短的入参。房间靠它识别外部动作。
const summaryOf = input => {
  const value = input !== null && typeof input === 'object' ? input : {}
  const command = typeof value.command === 'string' ? value.command.trim() : ''
  if (command !== '') return command.slice(0, 8000)
  const path = typeof value.path === 'string'
    ? value.path
    : typeof value.file_path === 'string' ? value.file_path : ''
  if (path !== '') return path.slice(0, 8000)
  const text = JSON.stringify(value)
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

export default function registerBaseExtension(pi) {
  const path = process.env.LODGE_MCP_CONFIG
  if (path) {
    const config = JSON.parse(readFileSync(path, 'utf8'))
    for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
      if (server === null || typeof server !== 'object' || server.enabled === false) continue
      pi.registerMcpServer(name, server)
    }
  }

  if (SKILLS_DIR !== '') {
    pi.registerTool({
      name: SKILL_TOOL,
      label: '读取技能',
      description: '读取一个技能的完整说明。name 取自系统提示里的技能清单。',
      promptSnippet: '读取技能全文（技能清单在系统提示里）',
      parameters: skillParameters,
      async execute(_toolCallId, params) {
        const name = String(params?.name ?? '').trim()
        const file = resolve(SKILLS_DIR, `${name}.md`)
        const safe = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name) && file.startsWith(SKILLS_DIR + sep)
        if (!safe || !existsSync(file)) {
          return {
            content: [{ type: 'text', text: `没有这个技能：${name || '(空)'}。只用系统提示里列出的名字。` }],
            details: {},
          }
        }
        return { content: [{ type: 'text', text: readFileSync(file, 'utf8') }], details: {} }
      },
    })
  }

  pi.on('tool_call', async (event, ctx) => {
    const name = String(event?.toolName ?? '')
    if (name === '') return
    // 房间禁止的手先拦：契约工具也要过角色的 gate 矩阵。
    if (denied(name)) {
      return { block: true, reason: '这间房禁止使用这项工具；换一种做法，或先让房间放开。' }
    }
    // 房间契约工具是房间的一部分，不属于成员的能力授权。
    if (name.startsWith(CONTRACT_TOOL)) return
    // 平台给的“按需读技能”工具：读的是这个成员已经分到的技能，不是外部动作。
    if (name === SKILL_TOOL) return
    // 网关的读回工具可能带服务器前缀：mcp__<server>__lodge_mcp_read。
    if (name === GATE_READ_TOOL || name.endsWith(`__${GATE_READ_TOOL}`)) return
    if (!granted(name)) {
      return { block: true, reason: '这个成员没有这项工具；要加就先让房间开。' }
    }
    if (READ_ONLY.has(name) || autoServer(name)) return
    // 本机的读和跑不问人；只有会打出去或不可逆的命令才停下来问。
    if (name === 'bash' && !riskyCommand(event.input)) return
    if ((name === 'write' || name === 'edit') && insideWorkspace(event.input)) return
    if (!ASK) return
    // 标题是驱动认的工具名格式，不是界面文案：基座按它把真实工具写进审批卡，
    // 再用产品语言重写问题。改文案时别动这个格式。
    // confirm 在不交互的模式下会等基座回答；关掉/超时返回 undefined，按拒绝处理。
    const allowed = await ctx.ui.confirm(`Allow ${name}?`, summaryOf(event.input))
    if (allowed !== true) {
      return { block: true, reason: '人拒绝了这次调用；换一种做法，或先说明为什么需要它。' }
    }
  })
}
