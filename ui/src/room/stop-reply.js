import { createElement as h, useState } from 'react'
import { StopIcon } from '../icons.js'

// 只认真正在跑的回合：近两分钟的工具活动只是展示用的在场信号，回合结束后不能继续留着停止键。
export const turnRunning = room => {
  if (room?.state !== 'active' || room?.live !== true) return false
  const busy = Array.isArray(room.busyMembers) && room.busyMembers.length > 0
  const queued = (Array.isArray(room.turnQueue) ? room.turnQueue : [])
    .some(item => item?.state === 'queued')
  return busy || queued ||
    room.chat?.running === true ||
    room.chat?.hostThinking === true
}

// 输入条上的刹车：只停下这次回复，不改变房间状态，也不加确认步骤。
export function StopReply({ room, onInterrupt = null }) {
  const [busy, setBusy] = useState(false)
  if (onInterrupt === null || !turnRunning(room)) return null
  const interrupt = async () => {
    if (busy) return
    setBusy(true)
    await onInterrupt()
    setBusy(false)
  }
  return h('button', {
    type: 'button',
    className: 'crew-send',
    'aria-label': '停止回复',
    title: '停止回复',
    'data-stop': 'true',
    disabled: busy,
    onClick: () => void interrupt(),
  }, h(StopIcon))
}
