// 渲染层只报“有几个房间需要你”和一条通知；角标、截断和打扰规则由主进程定。
export const clampBadge = count => (Number.isInteger(count) ? Math.max(0, Math.min(99, count)) : 0)

export const roomsPayload = rooms => (Array.isArray(rooms)
  ? rooms
    .filter(room => typeof room?.id === 'string' && typeof room?.name === 'string')
    .slice(0, 9)
    .map(room => ({ id: room.id.slice(0, 120), name: room.name.slice(0, 80) }))
  : [])

// 人正看着窗口时不打扰；离开窗口才提醒。通知内容也在这里截断。
export const attentionDecision = ({ payload, supported, focused }) => {
  const count = clampBadge(payload?.count)
  const notify = payload?.notify
  const deliver = notify !== null &&
    notify !== undefined &&
    supported === true &&
    focused !== true &&
    typeof notify?.roomId === 'string' &&
    typeof notify?.title === 'string' &&
    typeof notify?.body === 'string'
  return {
    count,
    notify: deliver
      ? {
        roomId: notify.roomId,
        title: notify.title.slice(0, 120),
        body: notify.body.slice(0, 240),
      }
      : null,
  }
}
