import { failureNextStep } from '../../../shared/failure.js'
import { memberNameOf } from './member-name.js'

// 两种房型共用的决策原语：名字、清理文本、暂停/停止态。
export const nameOf = (room, memberId) => memberNameOf(room, memberId) || '成员'

const statusOfPaused = room => {
  if (room.pauseReason === 'member_error') {
    const reason = room.needsYou?.label ?? `${nameOf(room, room.memberError?.memberId)}没能回应`
    return { title: `${reason}，没做成`, tone: 'paused' }
  }
  if (room.pauseReason === 'mcp') return { title: '连接中断', tone: 'paused' }
  if (room.pauseReason === 'approval') return { title: '确认超时', tone: 'paused' }
  if (room.pauseReason === 'budget') return { title: '这一轮的额度用完了', tone: 'paused' }
  return { title: room.idle === true ? '已暂停，可以接着聊' : '已暂停', tone: 'paused' }
}

const MEMBER_FIX_LABEL = {
  auth: '重新登录',
  quota: '换个模型',
  rate_limit: '换个模型',
  engine: '检查模型服务',
}

export const pausedMemberFixOf = room => {
  if (room?.state !== 'paused' || room?.pauseReason !== 'member_error') return null
  const memberId = room?.memberError?.memberId
  if (typeof memberId !== 'string' || memberId === '') return null
  return {
    memberId,
    label: MEMBER_FIX_LABEL[room.memberError?.kind] ?? '处理这位成员',
  }
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
    detail: failureNextStep(room.memberError?.kind),
    primary: { label: '继续', action: 'resume' },
    secondary: null,
  }
}
