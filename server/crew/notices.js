// 时间线只说人需要知道的那一句；原始错误留在 meta 和日志里，需要时再查。
// 需要人处理的错误要看得见；自动重试、后台噪音不进时间线，避免让人操心。
const NEEDS_USER = /需要你|由你确认|需要时点继续|还没开始|下一步还没安排|你停下了|结果还在房间里|检查没有执行|稍后再试|可以验收了|连接|连上|重试|稍后/

export const systemNotice = ({ store, roomId, text, error }) => {
  const detail = error === undefined || error === null ? '' : String(error?.message ?? error).trim()
  if (detail !== '') console.warn(`[lodge] ${text}：${detail}`)
  return store.appendMessage(roomId, {
    kind: 'system',
    text,
    meta: {
      kind: 'notice',
      show: NEEDS_USER.test(text),
      ...(detail === '' ? {} : { detail: detail.slice(0, 500) }),
    },
  })
}
