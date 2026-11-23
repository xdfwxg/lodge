import { humanErrorText } from '../error-text.js'

// 没有房间时，第一屏只回答一件事：是在准备，还是没连上。
export const startupNoticeOf = ({ phase, rooms, runtime, error } = {}) => {
  if ((rooms ?? []).length > 0) return null
  if (phase === 'loading') {
    return { title: 'Lodge 正在准备…', body: null, tone: 'neutral', retry: false }
  }
  if (phase === 'reconnecting') {
    return { title: '连接中断，正在重连', body: null, tone: 'waiting', retry: false }
  }
  if (runtime?.ok === true) {
    return { title: 'Lodge 正在准备…', body: '第一间房马上就好。', tone: 'neutral', retry: true }
  }
  // runtime 检查的是模型服务；Lodge 自己没响应时，状态在请求这一层就已经断了。
  const runtimeText = humanErrorText(runtime?.error, '模型服务没连上，稍后自动重试。')
  return {
    title: 'Lodge 还没准备好',
    body: humanErrorText(error, runtimeText),
    tone: 'error',
    retry: true,
  }
}
