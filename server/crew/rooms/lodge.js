import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createBodyFactory } from '../body.js'
import { LODGE_NAME, LODGE_ROOM_ID } from '../../../shared/lodge.js'

const HOST_SOUL = [
  '你是 Lodge，用户的幕僚长，也是这间房里唯一说话的人。',
  '用户说一件事时，先判断：要交一个具体结果，就表明要开一间工作室；只是想聊聊，就陪他把话理清。',
  '你不直接执行、不调用工具、不虚报完成；不要把开房说成做完，房间里的工作由那间房的成员负责。',
  '回答短，像人说话；每次只说一件事。',
].join('\n')

const roomRecord = ({ host, chatRoom, dir }) => ({
  id: LODGE_ROOM_ID,
  kind: 'room',
  name: LODGE_NAME,
  goal: '把想做的事交给 Lodge；还没想清楚就先聊聊。',
  templateId: 'lodge',
  roomType: 'chat',
  live: true,
  demo: false,
  state: 'active',
  lodge: true,
  leadMemberId: null,
  members: [],
  chatRoom,
  chatHost: { memberRef: host.id, name: host.name, displayName: LODGE_NAME },
  chat: {
    round: 1,
    phase: 'discussing',
    turnLimit: 6,
    turns: 0,
    conclusionId: null,
    running: false,
    speaker: '',
    note: '',
  },
  stages: [],
  plan: null,
  constraints: [
    'Lodge 只判断和开房；房间里的工作由成员完成',
    '开房前不改成员、不改工作文件夹；需要时走“更多选项”',
  ],
  workspace: {
    provider: 'plain',
    capabilities: { vcs: 'none', isolation: 'none', commit: false, diff: 'none' },
  },
  sourceRepo: dir,
  repoPath: dir,
  branch: null,
  worktrees: {},
  branches: {},
  ports: {},
  workspaceEnv: {},
  capabilities: {},
  parentRoomId: null,
  depth: 0,
  childRoomIds: [],
  idle: false,
  round: 0,
  noProgress: 0,
  turnQueue: [],
  heldMembers: [],
  heldMessages: {},
  version: 1,
})

// Lodge 是一间固定的、只有主持人的聊天室：它是入口，不是第四种房间引擎。
export const ensureLodgeRoom = async ({ store, engine, live, workspace, emit = () => {} }) => {
  const existing = store.readRoom(LODGE_ROOM_ID)
  if (existing !== null) {
    if (existing.archivedAt === undefined || existing.archivedAt === null) return existing
    const restored = store.updateRoom(existing.id, current => {
      current.archivedAt = null
      return { events: [{ type: 'room.restored' }] }
    })
    if (restored !== null) emit('room', restored)
    return restored ?? existing
  }

  const dir = join(workspace.root(), 'lodge')
  mkdirSync(dir, { recursive: true })
  const bodies = createBodyFactory({ engine })
  const host = await bodies.createHost({
    name: `LodgeHost${randomUUID().slice(0, 6)}`,
    soul: HOST_SOUL,
    description: '幕僚长 · 判断、开房、陪聊',
    approval: 'ask',
  })
  let chatRoom = null
  try {
    chatRoom = await engine.createRoom({
      name: `${LODGE_NAME} · 对话`,
      goal: '把想做的事交给 Lodge。',
      bulletin: '这是 Lodge 自己的对话：先判断要交结果还是聊聊，再决定开房。',
      members: [host.id],
      cwd: dir,
      leadId: host.id,
      responder: { kind: 'mentions' },
    })
    const room = roomRecord({ host, chatRoom, dir })
    store.writeRoom(room)
    store.appendMessage(room.id, {
      kind: 'chat',
      authorId: 'lodge',
      text: '我是 Lodge。想做点什么，还是先聊聊？',
    })
    try {
      await live.attach(room, { resume: false })
    } catch (error) {
      console.warn(`[lodge] Lodge 房间没有连上：${error?.message ?? error}`)
    }
    emit('room', store.readRoom(room.id) ?? room)
    return store.readRoom(room.id) ?? room
  } catch (error) {
    // 半途失败把基座上的主持人和房间一起收回，下一次启动再试。
    try { if (chatRoom !== null) await engine.deleteRoom(chatRoom.id) } catch {}
    try { await bodies.retireHost(host.id) } catch {}
    throw error
  }
}
