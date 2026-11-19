// 基座错误对用户只说中文原因：接口路径、状态码和原始英文留在日志里。
export const plainRuntimeError = error => {
  const raw = String(error?.message ?? error ?? '')
  if (/this channel is working|waiting on you|finish that turn first/i.test(raw)) {
    return '房间正在做事，等这一轮结束再试'
  }
  if (/must come from the desktop app|paired device/i.test(raw)) {
    return '这个基座属于另一个桌面应用，Lodge 不能改它'
  }
  if (/401|unauthorized|invalid api key|not logged in|run \/login/i.test(raw)) {
    return '模型服务没有登录，先登录再试'
  }
  if (/skills library is not enabled/i.test(raw)) return '这个成员的身体还没有开技能库；先把技能留空，或换一具支持技能的身体'
  if (/423|locked/i.test(raw)) return '基座暂时被占用，稍后再试'
  if (/403|forbidden/i.test(raw)) return '基座拒绝了这次操作'
  if (/404|not found/i.test(raw)) return '基座里找不到对应的记录'
  const botLimit = /limited to (\d+) bots/i.exec(raw)
  if (botLimit !== null) return `基座 Bot 已满（${botLimit[1]} 个）；先删除不用的旧房间再建新房`
  if (/409|conflict/i.test(raw)) return '房间状态已经变化，刷新后再试'
  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|aborted|timeout/i.test(raw)) {
    return '基座没有响应，稍后再试'
  }
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  console.warn(`[lodge] 基座错误：${raw}`)
  return '基座出了点问题，稍后再试'
}
