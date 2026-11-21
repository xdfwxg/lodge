import { chatStatusOf, idleDelivered, roomStatusOf } from '../../../shared/room-status.js'

// 岛屿状态机：状态键共享，工作室和聊天室各自读自己的词表。
export const ISLAND_STATUS = Object.freeze({
  studio: Object.freeze({
    running: Object.freeze({ barLabel: null, stageLabel: '进行中', tone: 'active' }),
    waiting: Object.freeze({ barLabel: '等你决定', stageLabel: '等你决定', tone: 'waiting' }),
    idle: Object.freeze({ barLabel: '空闲中', stageLabel: '空闲中', tone: 'active' }),
    paused: Object.freeze({ barLabel: '已暂停', stageLabel: '已暂停', tone: 'waiting' }),
    stopped: Object.freeze({ barLabel: '已停止', stageLabel: '已停止', tone: 'stopped' }),
    archived: Object.freeze({ barLabel: '已归档', stageLabel: '已归档', tone: 'stopped' }),
    done: Object.freeze({ barLabel: null, stageLabel: '', tone: 'done' }),
  }),
  chat: Object.freeze({
    running: Object.freeze({ barLabel: '正在聊', stageLabel: '正在聊', tone: 'active' }),
    summarizing: Object.freeze({ barLabel: '正在收一下', stageLabel: '正在收一下', tone: 'active' }),
    waiting: Object.freeze({ barLabel: '聊到这儿了', stageLabel: '聊到这儿了', tone: 'waiting' }),
    idle: Object.freeze({ barLabel: '还没开始聊', stageLabel: '还没开始聊', tone: 'active' }),
    paused: Object.freeze({ barLabel: '已暂停，随时接着聊', stageLabel: '已暂停，随时接着聊', tone: 'waiting' }),
    stopped: Object.freeze({ barLabel: '已停止', stageLabel: '已停止', tone: 'stopped' }),
    archived: Object.freeze({ barLabel: '已归档', stageLabel: '已归档', tone: 'stopped' }),
  }),
})

export const islandWorking = room => (
  room?.working === true ||
  (Array.isArray(room?.busyMembers) ? room.busyMembers.length > 0 : false) ||
  ['running', 'summarizing', 'thinking'].includes(chatStatusOf(room))
)

const studioState = room => {
  const status = roomStatusOf(room)
  if (status === 'archived') return 'archived'
  if (status === 'stopped') return 'stopped'
  if (status === 'paused') return 'paused'
  if (status === 'active') {
    if (islandWorking(room)) return 'running'
    return room?.needsYou ? 'waiting' : 'idle'
  }
  if (room?.needsYou) return 'waiting'
  return idleDelivered(room) ? 'done' : 'idle'
}

const chatState = room => {
  const status = chatStatusOf(room)
  if (status === 'archived') return 'archived'
  if (status === 'paused') return 'paused'
  if (status === 'stopped') return 'stopped'
  if (status === 'summarizing') return 'summarizing'
  if (status === 'concluded') return 'waiting'
  if (status === 'running' || status === 'thinking' || status === 'discussing') return 'running'
  return 'idle'
}

export const islandStatusOf = (room, kind = 'studio') => {
  const table = ISLAND_STATUS[kind] ?? ISLAND_STATUS.studio
  const key = kind === 'chat' ? chatState(room) : studioState(room)
  return { key, ...table[key] }
}
