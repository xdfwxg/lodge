// 时间线按落库顺序读，不按消息自带的 ts：基座的活动发生得早、补进房间得晚，
// 用 ts 会把“验收员开始翻看”排到“@验收员”前面。没有 seq 的本地临时消息跟在后面按 ts 排。
const SEQ_BASE = 1e15

export const messageOrderOf = message => {
  if (typeof message?.seq === 'number') return message.seq
  return SEQ_BASE + (typeof message?.ts === 'number' ? message.ts : 0)
}
