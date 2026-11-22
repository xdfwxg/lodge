// 真实基座群聊探针：复用房间席位 bot，建临时群，问一句，确认只回答、不使用工具。
// 需要 Lodge 与基座都在运行；不写房间记录，结束时删除临时群。
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'
import { ROOM_CHAT_BULLETIN } from '../server/crew/room-chat.js'
import { pickChatRoom } from './eval-chat-room.mjs'

const baseUrl = process.env.CREW_BASE_URL ?? 'http://127.0.0.1:8799'
const stateUrl = process.env.LODGE_STATE_URL ?? 'http://127.0.0.1:8787/api/state'
const dataDir = resolve(process.env.CREW_DATA_DIR ?? '.data')
const roomArg = process.argv.find(arg => arg.startsWith('--room='))?.slice('--room='.length)
const timeoutMs = Number(process.env.LODGE_EVAL_CHAT_TIMEOUT_MS ?? 90_000)

const json = async (url, options = {}) => {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`${response.status} ${url}: ${body.slice(0, 300)}`)
  return body === '' ? null : JSON.parse(body)
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// 公开状态会剥掉身体引用；本地评测只读数据库拿内部引用，不给 UI 开泄漏口。
const database = new DatabaseSync(join(dataDir, 'crew.db'), { readOnly: true })
let rooms = []
try {
  rooms = database.prepare('SELECT payload FROM room').all().map(row => JSON.parse(row.payload))
} finally {
  database.close()
}
const roomState = await json(stateUrl)
const publicRooms = roomState.rooms ?? []
const picked = pickChatRoom(rooms, roomArg)
if (picked.error !== undefined) throw new Error(picked.error)
const room = picked.room
const visible = publicRooms.find(item => item.id === room.id)
if (visible === undefined) throw new Error(`房间 ${room.id} 不在 Lodge 状态里`)
const members = (room.members ?? []).map(member => member.body?.ref).filter(ref => typeof ref === 'string' && ref !== '')
const lead = (room.members ?? []).find(member => member.role === 'lead' || member.roleKind === 'planner')
const executor = (room.members ?? []).find(member => member.roleKind === 'executor' || member.role === 'worker')?.name
if (typeof executor !== 'string' || executor === '') throw new Error('房间没有执行者 handle')

let group = null
try {
  const created = await json(`${baseUrl}/api/groups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Lodge chat eval ${Date.now()}`, memberIds: members }),
  })
  group = created.group ?? created
  await json(`${baseUrl}/api/groups/${group.id}/setup`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'complete',
      cwd: room.repoPath ?? '/tmp',
      bulletin: ROOM_CHAT_BULLETIN,
      defaultResponder: { kind: 'auto', fallbackBotId: lead?.body?.ref ?? members[0] },
    }),
  })
  const sent = await json(`${baseUrl}/api/groups/${group.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: `@${executor} 20个字告诉我你能干啥` }),
  })
  const deadline = Date.now() + timeoutMs
  let messages = []
  let reply = null
  while (Date.now() < deadline) {
    const page = await json(`${baseUrl}/api/threads/${group.threadId}/messages?limit=50`)
    messages = page.messages ?? []
    reply = [...messages].reverse().find(message => (
      message.kind === 'text' &&
      message.role === 'bot' &&
      message.from?.name === executor &&
      (message.at ?? 0) >= (sent.message?.at ?? 0)
    ))
    if (reply !== undefined) break
    await sleep(1_000)
  }
  const after = messages.filter(message => (message.at ?? 0) >= (sent.message?.at ?? 0))
  // 近期工作摘要等上下文注入也会写成 activity；只把已知工具名/MCP 调用算作工具使用。
  const toolNames = new Set(['Bash', 'Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Task', 'Agent', 'TodoWrite', 'NotebookEdit'])
  const activity = after.filter(message => (
    message.kind === 'activity' &&
    typeof message.tool?.name === 'string' &&
    (toolNames.has(message.tool.name) || /^mcp[_:]/.test(message.tool.name))
  ))
  if (reply === undefined) throw new Error('执行者没有在时限内回答')
  if (activity.length > 0) throw new Error(`聊天回合使用了工具：${JSON.stringify(activity, null, 2).slice(0, 1200)}`)
  console.log('PASS chat answer:', reply.text.trim())
  console.log('PASS tools used:', activity.length)
} finally {
  if (group !== null) {
    await fetch(`${baseUrl}/api/groups/${group.id}`, { method: 'DELETE' }).catch(() => {})
  }
}

