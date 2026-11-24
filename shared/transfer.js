// 房间之间的流转留痕：来源房间带过来了什么，不复制原房间的过程。
// 父子房间的任务交接会复用这条记录，但不提前增加未实现的 kind。
const clean = value => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '')

export const transferOf = ({
  handoffBrief = null,
  receipt = null,
  fromRoomId = '',
  fromRoomName = '',
  at = Date.now(),
}) => {
  const kind = handoffBrief !== null && handoffBrief !== undefined
    ? 'handoff'
    : receipt !== null && receipt !== undefined ? 'receipt' : null
  if (kind === null) return null
  const sourceId = clean(fromRoomId).slice(0, 120)
  const sourceName = clean(fromRoomName).slice(0, 120)
  return {
    kind,
    ...(sourceId === '' ? {} : { fromRoomId: sourceId }),
    ...(sourceName === '' ? {} : { fromRoomName: sourceName }),
    at,
  }
}
