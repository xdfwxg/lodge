import { memberOf } from '../../room-members.js'

// 交接只有一个写法：系统按这一拍的真实目标生成一条 @，模型不写 @。
// 目标为空、指向自己、不是本房成员、或不是工作室，都不生成。
export const projectionTargetsOf = ({ room, from, targets }) => {
  if (room?.roomType !== 'studio' || room?.modeCapabilities?.stages === false) return []
  return [...new Set((Array.isArray(targets) ? targets : [])
    .filter(id => typeof id === 'string' && id !== '' && id !== from && memberOf(room, id) !== null))]
}

export const appendHandoffProjection = ({
  store,
  roomId,
  room,
  from,
  targets,
  message,
  meta = {},
}) => {
  const to = projectionTargetsOf({ room, from, targets })
  if (to.length === 0) return null
  const dedupeKey = typeof meta.dedupeKey === 'string' ? meta.dedupeKey : ''
  if (dedupeKey !== '' && store.readMessages(roomId).some(item => item.meta?.dedupeKey === dedupeKey)) {
    return null
  }
  const text = typeof message === 'function' ? message(to) : String(message ?? '')
  if (text.trim() === '') return null
  return store.appendMessage(roomId, {
    kind: 'system',
    authorId: from,
    text,
    meta: { ...meta, kind: 'handoff', from, to, authorKind: 'system', ...(dedupeKey === '' ? {} : { dedupeKey }) },
  })
}
