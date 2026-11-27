import { stopOf } from './stop.js'

// 注意力路由：只在房间真的停住、等人时返回一个信号；不是未读数。
// 「停没停」的算法只有 stop.js 一处，这里是它在界面和评测里的对外名字。
export const roomNeedsYou = (room, messages = []) => stopOf(room, messages)

// 收件箱：这间房自己等人处理的事。第一条给胶囊和侧栏。
export const roomAttention = (room, messages = []) => {
  const stop = stopOf(room, messages)
  return stop === null ? [] : [stop]
}
