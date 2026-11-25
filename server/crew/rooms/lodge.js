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
  chat: initialChatState(),
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

// 基座上的主持人和对话房间；建房和修复入口共用这一份。
const provisionBase = async ({ engine, bodies, workspace }) => {
  const dir = join(workspace.root(), 'lodge')
  mkdirSync(dir, { recursive: true })
  const host = await bodies.createHost({
    name: `LodgeHost${randomUUID().slice(0, 6)}`,
    soul: HOST_SOUL,
    description: 'Lodge · 判断、开房、陪聊',
    approval: 'ask',
  })
  try {
    const chatRoom = await engine.createRoom({
      name: `${LODGE_NAME} · 对话`,
      goal: '把想做的事交给 Lodge。',
      bulletin: '这是 Lodge 自己的对话：先判断要交结果还是聊聊，再决定开房。',
      members: [host.id],
      cwd: dir,
      leadId: host.id,
      responder: { kind: 'mentions' },
    })
    return { host, chatRoom, dir }
  } catch (error) {
    try { await bodies.retireHost(host.id) } catch {}
    throw error
  }
}

const retireBase = async ({ engine, bodies, base }) => {
  try { if (base?.chatRoom != null) await engine.deleteRoom(base.chatRoom.id) } catch {}
  try { if (base?.host != null) await bodies.retireHost(base.host.id) } catch {}
}

// 新房间可能还在跑第一拍；连不上就等一会再试，不把入口挂在半截状态。
const attachLodgeRoom = async ({ store, live, room, attempts = 4 }) => {
  let last = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await live.attach(store.readRoom(room.id) ?? room, { resume: false })
      return
    } catch (error) {
      last = error
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
  log.warn(`[lodge] Lodge 房间没有连上：${last?.message ?? last}`)
}

// Lodge 是一间固定的、只有主持人的聊天室：它是入口，不是第四种房间引擎。
export const ensureLodgeRoom = async ({ store, engine, live, workspace, emit = () => {} }) => {
  const bodies = createBodyFactory({ engine })
  let existing = store.readRoom(LODGE_ROOM_ID)
  if (existing !== null) {
    const restored = existing.archivedAt === undefined || existing.archivedAt === null
      ? existing
      : store.updateRoom(existing.id, current => {
        current.archivedAt = null
        return { events: [{ type: 'room.restored' }] }
      })
    if (restored !== null && restored !== existing) emit('room', restored)
    let missingBase = false
    if (typeof engine.patchMemberBot === 'function' &&
      typeof existing.chatHost?.memberRef === 'string' && existing.chatHost.memberRef !== '') {
      try {
        await engine.patchMemberBot(existing.chatHost.memberRef, {
          soul: HOST_SOUL,
          description: 'Lodge · 判断、开房、陪聊',
        })
      } catch (error) {
        const reason = String(error?.message ?? error)
        log.warn(`[lodge] Lodge 主机器人没有更新：${reason}`)
        // 基座对不存在的对象回 404；不认具体词，避免业务层带进基座词汇。
        missingBase = /404/.test(reason) && /no such/i.test(reason)
      }
    }
    if (!missingBase) return restored ?? existing
    // 基座里已经没有这位主持和这段对话，本地历史没有对应的现场，不留。
    log.warn('[lodge] 基座里没有 Lodge 主持了；清掉本地记录，重新建入口')
    try { live.detach?.(existing.id) } catch {}
    store.deleteRoom(existing.id)
    existing = null
  }

  let base = null
  try {
    base = await provisionBase({ engine, bodies, workspace })
    const room = roomRecord({ host: base.host, chatRoom: base.chatRoom, dir: base.dir })
    store.writeRoom(room)
    store.appendMessage(room.id, {
      kind: 'chat',
      authorId: 'lodge',
      text: '我是 Lodge。想做点什么，还是先聊聊？',
    })
    await attachLodgeRoom({ store, live, room })
    emit('room', store.readRoom(room.id) ?? room)
    return store.readRoom(room.id) ?? room
  } catch (error) {
    // 半途失败把基座上的主持人和房间一起收回，下一次启动再试。
    await retireBase({ engine, bodies, base })
    throw error
  }
}
