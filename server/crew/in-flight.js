// 「平台手上还有没有活」只有这一份定义。界面判“停没停”、复核判“要不要催”都读它，
// 不各写一遍——各写一遍就会出现“卡上说等人、平台其实在干活”。

// 硬事实：有人在跑、有派工在路上、有成员在忙。
export const platformBusy = room => (
  (room?.turnQueue ?? []).some(item => item?.state === 'running') ||
  (room?.busyMembers ?? []).length > 0 ||
  (room?.assignments ?? []).some(item => ['sent', 'working'].includes(item.status))
)

// 基座的 working 标记有时比工具活动晚一拍；最近的工具活动也算这一回合还在跑。
// 只用来压掉基于旧证据的“验收员在看/待重做”，不压人的交接、阻塞和超时。
export const RECENT_ACTIVITY_MS = 2 * 60_000
export const recentlyActive = (room, messages, index) => {
  if (platformBusy(room)) return true
  // 退回之后到执行官第一次动手之间有几秒空档，那时不能闪一张“待重做”给人。
  if ((room?.assignments ?? []).some(item => (
    item.stageIndex === index && ['sent', 'working'].includes(item.status)
  ))) return true
  const now = Date.now()
  return (messages ?? []).some(message => (
    message.kind === 'activity' &&
    Number.isFinite(message.ts) &&
    now - message.ts < RECENT_ACTIVITY_MS
  ))
}
