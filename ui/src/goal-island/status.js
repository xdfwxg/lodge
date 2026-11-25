import { chatStatusOf, idleDelivered, roomStatusOf } from '../../../shared/room-status.js'
import { needsAction } from '../needs.js'
import { CHAT_STATE_WORD, ROOM_STATE_WORD } from '../room/status-words.js'

// 岛屿状态机：状态键共享，工作室和聊天室各自读自己的词表。
export const ISLAND_STATUS = Object.freeze({
  studio: Object.freeze({
    running: Object.freeze({ barLabel: null, stageLabel: ROOM_STATE_WORD.active, tone: 'active' }),
    waiting: Object.freeze({ barLabel: '等你决定', stageLabel: '等你决定', tone: 'waiting' }),
    idle: Object.freeze({ barLabel: ROOM_STATE_WORD.idle, stageLabel: ROOM_STATE_WORD.idle, tone: 'active' }),
    paused: Object.freeze({ barLabel: ROOM_STATE_WORD.paused, stageLabel: ROOM_STATE_WORD.paused, tone: 'waiting' }),
    stopped: Object.freeze({ barLabel: ROOM_STATE_WORD.stopped, stageLabel: ROOM_STATE_WORD.stopped, tone: 'stopped' }),
    archived: Object.freeze({ barLabel: ROOM_STATE_WORD.archived, stageLabel: ROOM_STATE_WORD.archived, tone: 'stopped' }),
    done: Object.freeze({ barLabel: null, stageLabel: '', tone: 'done' }),
  }),
  chat: Object.freeze({
    selecting: Object.freeze({ barLabel: CHAT_STATE_WORD.selecting, stageLabel: CHAT_STATE_WORD.selecting, tone: 'active' }),
    running: Object.freeze({ barLabel: CHAT_STATE_WORD.running, stageLabel: CHAT_STATE_WORD.running, tone: 'active' }),
    summarizing: Object.freeze({ barLabel: CHAT_STATE_WORD.summarizing, stageLabel: CHAT_STATE_WORD.summarizing, tone: 'active' }),
    waiting: Object.freeze({ barLabel: CHAT_STATE_WORD.concluded, stageLabel: CHAT_STATE_WORD.concluded, tone: 'waiting' }),
    idle: Object.freeze({ barLabel: CHAT_STATE_WORD.idle, stageLabel: CHAT_STATE_WORD.idle, tone: 'active' }),
    paused: Object.freeze({ barLabel: '已暂停，随时接着聊', stageLabel: '已暂停，随时接着聊', tone: 'waiting' }),
    stopped: Object.freeze({ barLabel: CHAT_STATE_WORD.stopped, stageLabel: CHAT_STATE_WORD.stopped, tone: 'stopped' }),
    archived: Object.freeze({ barLabel: CHAT_STATE_WORD.archived, stageLabel: CHAT_STATE_WORD.archived, tone: 'stopped' }),
  }),
})

export const islandWorking = room => (
  room?.working === true ||
  (Array.isArray(room?.busyMembers) ? room.busyMembers.length > 0 : false) ||
  ['selecting', 'running', 'summarizing', 'thinking'].includes(chatStatusOf(room))
)

const studioState = room => {
  const status = roomStatusOf(room)
  const waiting = needsAction(room) !== null
  if (status === 'archived') return 'archived'
  if (status === 'stopped') return 'stopped'
  if (status === 'paused') return 'paused'
  // 只要这一轮还在跑，就不是“空闲中”；没有当前回合时让岛显示当前阶段。
  if (status === 'active') return waiting ? 'waiting' : 'running'
  if (waiting) return 'waiting'
  return idleDelivered(room) ? 'done' : 'idle'
}

const chatState = room => {
  const status = chatStatusOf(room)
  if (status === 'archived') return 'archived'
  if (status === 'paused') return 'paused'
  if (status === 'stopped') return 'stopped'
  if (status === 'summarizing') return 'summarizing'
  if (status === 'concluded') return 'waiting'
  if (status === 'selecting') return 'selecting'
  if (status === 'running' || status === 'thinking' || status === 'discussing') return 'running'
  return 'idle'
}

export const islandStatusOf = (room, kind = 'studio') => {
  const table = ISLAND_STATUS[kind] ?? ISLAND_STATUS.studio
  const key = kind === 'chat' ? chatState(room) : studioState(room)
  return { key, ...table[key] }
}
