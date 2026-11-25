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

// “等你决定”只留给真需要人拍板的分叉；阻塞、退回、合并冲突各有自己的词。
const waitingWordOf = need => {
  if (need === null || need === undefined) return null
  switch (need.kind) {
    case 'decision': return '等你决定'
    case 'question': return '待回答'
    case 'approval': return '待确认'
    case 'blocked': return '停住了'
    case 'rework': return '待重做'
    case 'merge': return '合并冲突'
    case 'parallel': return '卡住了'
    case 'review-timeout': return '复核超时'
    case 'connection': return '连接断了'
    case 'mcp': return '连接中断'
    case 'budget': return '额度用完了'
    case 'error': return need.label || '出错了'
    default: return need.label || null
  }
}

export const islandStatusOf = (room, kind = 'studio') => {
  const table = ISLAND_STATUS[kind] ?? ISLAND_STATUS.studio
  const key = kind === 'chat' ? chatState(room) : studioState(room)
  const status = { key, ...table[key] }
  if (kind !== 'chat' && key === 'waiting') {
    const word = waitingWordOf(needsAction(room))
    if (word !== null) return { ...status, barLabel: word, stageLabel: word }
  }
  return status
}
