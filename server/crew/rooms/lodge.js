import * as log from '../log.js'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createBodyFactory } from '../body.js'
import { LODGE_NAME, LODGE_ROOM_ID } from '../../../shared/lodge.js'
import { LODGE_HOST_SOUL } from '../../../shared/lodge-host.js'
import { ROOM_STATE } from '../../../shared/states.js'
import { initialChatState } from '../room-types/chat.js'

const HOST_SOUL = LODGE_HOST_SOUL

const roomRecord = ({ host, chatRoom, dir }) => ({
  id: LODGE_ROOM_ID,
  kind: 'room',
  name: LODGE_NAME,
  goal: '把想做的事交给 Lodge；还没想清楚就先聊聊。',
  templateId: 'lodge',
  roomType: 'chat',
  live: true,
  demo: false,
  state: ROOM_STATE.active,
  lodge: true,
  leadMemberId: null,
  members: [],
  chatRoom,
  chatHost: { memberRef: host.id, name: host.name, displayName: LODGE_NAME },
  chat: initialChatState({ turnLimit: 6 }),
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
  idle: false,
  turnCount: 0,
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
    const restored = existing.archivedAt === undefined || existing.archivedAt === null
      ? existing
      : store.updateRoom(existing.id, current => {
        current.archivedAt = null
        return { events: [{ type: 'room.restored' }] }
      })
    if (restored !== null && restored !== existing) emit('room', restored)
    if (typeof engine.patchMemberBot === 'function' &&
      typeof existing.chatHost?.memberRef === 'string' && existing.chatHost.memberRef !== '') {
      try {
        await engine.patchMemberBot(existing.chatHost.memberRef, {
          soul: HOST_SOUL,
          description: 'Lodge · 判断、开房、陪聊',
        })
      } catch (error) {
        log.warn(`[lodge] Lodge 主机器人没有更新：${error?.message ?? error}`)
      }
    }
    return restored ?? existing
  }

  const dir = join(workspace.root(), 'lodge')
  mkdirSync(dir, { recursive: true })
  const bodies = createBodyFactory({ engine })
  const host = await bodies.createHost({
    name: `LodgeHost${randomUUID().slice(0, 6)}`,
    soul: HOST_SOUL,
    description: 'Lodge · 判断、开房、陪聊',
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
      log.warn(`[lodge] Lodge 房间没有连上：${error?.message ?? error}`)
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
