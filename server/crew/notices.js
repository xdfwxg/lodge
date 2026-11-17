// 时间线只说人需要知道的那一句；原始错误留在 meta 和日志里，需要时再查。
export const systemNotice = ({ store, roomId, text, error }) => {
  const detail = error === undefined || error === null ? '' : String(error?.message ?? error).trim()
  if (detail !== '') console.warn(`[lodge] ${text}：${detail}`)
  return store.appendMessage(roomId, {
    kind: 'system',
    text,
    ...(detail === '' ? {} : { meta: { detail: detail.slice(0, 500) } }),
  })
}
