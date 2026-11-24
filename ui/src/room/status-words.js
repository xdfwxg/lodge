// 状态词只留一份：侧栏行、岛和胶囊都从这里取，避免各自维护一张表。
export const ROOM_STATE_WORD = Object.freeze({
  idle: '空闲中',
  active: '进行中',
  paused: '已暂停',
  stopped: '已停止',
  archived: '已归档',
})

export const CHAT_STATE_WORD = Object.freeze({
  running: '正在聊',
  summarizing: '正在收一下',
  concluded: '聊到这儿了',
  idle: '还没开始聊',
  paused: '已暂停',
  stopped: '已停止',
  archived: '已归档',
})

export const DELIVERED_WORD = '已交付'
