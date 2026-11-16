import { memberNameOf } from './member-name.js'

// 两种房型共用的决策原语：名字、清理文本、暂停/停止态。
export const nameOf = (room, memberId) => memberNameOf(room, memberId) || '成员'

export const cleanText = value => String(value ?? '')
  .replace(/\*\*/g, '')
  .replace(/`/g, '')
  .replace(/^#+\s*/gm, '')
  .replace(/\s+/g, ' ')
  .trim()

const statusOfPaused = room => {
  if (room.pauseReason === 'member_error') {
    const reason = room.needsYou?.label ?? `${nameOf(room, room.memberError?.memberId)}没能回应`
    return { title: `${reason}，需要处理`, tone: 'paused' }
  }
  if (room.pauseReason === 'mcp') return { title: '连接中断，需要处理', tone: 'paused' }
  if (room.pauseReason === 'approval') return { title: '确认超时，需要处理', tone: 'paused' }
  return { title: room.idle === true ? '已暂停，可以接着聊' : '已暂停', tone: 'paused' }
}

export const buildIdleDecision = room => {
  if (room.state === 'stopped') {
    return { key: 'stopped', title: '房间已停止', detail: '', primary: null, secondary: null }
  }
  if (room.state !== 'paused') return null
  const paused = statusOfPaused(room)
  return {
    key: 'paused',
    title: paused.title,
    detail: room.memberError?.kind === 'quota'
      ? '充值或给这位成员换个模型后，点“继续”。'
      : '处理完成后点“继续”。',
    primary: { label: '继续', action: 'resume' },
    secondary: null,
  }
}
