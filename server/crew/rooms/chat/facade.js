// 聊天室对外只暴露运行时需要的只读状态。
export const chatFacade = {
  runningOf: room => room?.chat?.running === true,
}
