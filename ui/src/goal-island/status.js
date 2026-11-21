import { idleDelivered, roomStatusOf } from '../../../shared/room-status.js'

// 岛屿状态机：状态键共享，工作室和聊天室各自读自己的词表。
export const ISLAND_STATUS = Object.freeze({
  studio: Object.freeze({
    running: Object.freeze({ barLabel: null, stageLabel: '进行中', tone: 'active' }),
    waiting: Object.freeze({ barLabel: '等你决定', stageLabel: '等你决定', tone: 'waiting' }),
    idle: Object.freeze({ barLabel: '空闲中', stageLabel: '空闲中', tone: 'active' }),
    paused: Object.freeze({ barLabel: '已暂停', stageLabel: '已暂停', tone: 'waiting' }),
    stopped: Object.freeze({ barLabel: '已停止', stageLabel: '已停止', tone: 'stopped' }),
    done: Object.freeze({ barLabel: null, stageLabel: '', tone: 'done' }),
  }),
  chat: Object.freeze({
    running: Object.freeze({ barLabel: '正在聊', stageLabel: '正在聊', tone: 'active' }),
    summarizing: Object.freeze({ barLabel: '正在收一下', stageLabel: '正在收一下', tone: 'active' }),
    waiting: Object.freeze({ barLabel: '聊到这儿了', stageLabel: '聊到这儿了', tone: 'waiting' }),
    idle: Object.freeze({ barLabel: '还没开始聊', stageLabel: '还没开始聊', tone: 'active' }),
    paused: Object.freeze({ barLabel: '已暂停，随时接着聊', stageLabel: '已暂停，随时接着聊', tone: 'waiting' }),
    stopped: Object.freeze({ barLabel: '已停止', stageLabel: '已停止', tone: 'stopped' }),
  }),
})

export const islandWorking = room => (
  room?.working === true ||
  (Array.isArray(room?.busyMembers) ? room.busyMembers.length > 0 : false) ||
  room?.chat?.running === true ||
  room?.chat?.hostThinking === true
)

const studioState = room => {
  const status = roomStatusOf(room)
  if (status === 'archived' || status === 'stopped') return 'stopped'
  if (status === 'paused') return 'paused'
  if (status === 'active') {
    if (islandWorking(room)) return 'running'
    return room?.needsYou ? 'waiting' : 'idle'
  }
  if (room?.needsYou) return 'waiting'
  return idleDelivered(room) ? 'done' : 'idle'
}

const chatState = room => {
  if (room?.state === 'paused') return 'paused'
  if (room?.state === 'stopped') return 'stopped'
  const chat = room?.chat ?? {}
  if (chat.phase === 'summarizing') return 'summarizing'
  if (chat.phase === 'concluded') return 'waiting'
  if (chat.running === true || chat.hostThinking === true) return 'running'
  const started = (Array.isArray(room?.messages) ? room.messages : []).some(message => (
    message.kind === 'chat' && message.authorId !== 'lodge' && message.authorId !== 'system'
  ))
  return started ? 'running' : 'idle'
}

export const islandStatusOf = (room, kind = 'studio') => {
  const table = ISLAND_STATUS[kind] ?? ISLAND_STATUS.studio
  const key = kind === 'chat' ? chatState(room) : studioState(room)
  return { key, ...table[key] }
}
