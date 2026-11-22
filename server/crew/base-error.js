import * as log from './log.js'
import { redactSecrets } from '../../shared/secrets.js'

// 服务错误对用户只说中文原因：接口路径、状态码和原始英文留在日志里。
export const plainRuntimeError = error => {
  const raw = redactSecrets(error?.message ?? error ?? '')
  if (/this channel is working|waiting on you|finish that turn first/i.test(raw)) {
    return '房间正在做事，等这一轮结束再试'
  }
  if (/must come from the desktop app|paired device/i.test(raw)) {
    return '这个 Lodge 服务属于另一个桌面应用，当前 Lodge 不能改它'
  }
  if (/401|unauthorized|invalid api key|not logged in|run \/login/i.test(raw)) {
    return '模型服务没有登录，先登录再试'
  }
  if (/skills library is not enabled/i.test(raw)) return '这个成员还没有开技能；先把技能留空，或换一个能用技能的成员'
  if (/423|locked/i.test(raw)) return 'Lodge 服务暂时被占用，稍后再试'
  if (/403|forbidden/i.test(raw)) return 'Lodge 服务没有接受这次操作，稍后再试'
  if (/404|not found/i.test(raw)) return 'Lodge 服务里找不到对应的记录'
  const botLimit = /limited to (\d+) bots/i.exec(raw)
  if (botLimit !== null) return `成员名额已满（${botLimit[1]} 个）；先删掉不用的旧房间再建新房`
  if (/409|conflict/i.test(raw)) return '房间状态已经变化，刷新后再试'
  if (/ECONNREFUSED|ECONNRESET|fetch failed|socket hang up|aborted|timeout/i.test(raw)) {
    return 'Lodge 服务没有响应，稍后再试'
  }
  if (/[\u4e00-\u9fff]/.test(raw)) return raw
  log.warn(`[lodge] 服务错误：${raw}`)
  return 'Lodge 服务出了点问题，稍后再试'
}
