import { stageStatusOf } from '../../../../shared/room-status.js'
import { AUTO_CHECK_STATUS, ISSUE_STATE, STAGE_STATUS } from '../../../../shared/states.js'

const ISSUE_STATE_OF = Object.freeze({
  active: ISSUE_STATE.in_progress,
  pending: ISSUE_STATE.todo,
  passed: ISSUE_STATE.done,
  blocked: ISSUE_STATE.blocked,
  waiting: ISSUE_STATE.blocked,
})

export const studioIssuesOf = room => (room.stages ?? []).map((stage, index) => {
  const status = stageStatusOf(room, index)
  return {
    id: `stage-${index}`,
    kind: 'stage',
    title: stage.title,
    state: ISSUE_STATE_OF[status] ?? ISSUE_STATE.todo,
    stage: index,
    acceptance: stage.acceptance ?? null,
    ownerIds: Array.isArray(stage.assignees) ? stage.assignees : [],
    blockers: status === STAGE_STATUS.blocked
      ? [room.mergeConflict?.stage === index ? '合并冲突等你处理' : '这一步卡住了，等你处理']
      : status === STAGE_STATUS.waiting ? ['等你处理'] : [],
  }
})

const count = (messages, kind) => messages.filter(message => message.kind === kind).length

const latestText = (messages, kind) => [...messages]
  .reverse()
  .find(message => message.kind === kind && typeof message.text === 'string' && message.text.trim() !== '')
  ?.text.trim() ?? ''

export const studioRetroOf = (room, messages = []) => {
  const items = []
  const reworks = count(messages, 'rework')
  if (reworks > 0) {
    const reason = latestText(messages, 'rework')
    items.push({
      kind: 'rework',
      text: `重做 ${reworks} 次${reason === '' ? '' : `：${reason}`}`,
      suggestion: '把这一步的验收写成一条能跑的检查，减少来回解释。',
    })
  }
  const timeouts = count(messages, 'review_timeout')
  if (timeouts > 0) {
    items.push({
      kind: 'timeout',
      text: `复核超时 ${timeouts} 次`,
      suggestion: '给复核留更明确的证据入口，或把阶段拆小。',
    })
  }
  if (room?.autoCheck?.status === AUTO_CHECK_STATUS.blocked || room?.autoCheck?.status === AUTO_CHECK_STATUS['limit-reached']) {
    items.push({
      kind: 'check',
      text: '自动检查没有通过',
      suggestion: '在派活前先确认这条检查能在工作副本里跑起来。',
    })
  }
  const trimmed = items.slice(0, 3)
  return {
    mode: 'studio',
    items: trimmed,
    summary: trimmed.length === 0 ? '这次没有明显摩擦' : trimmed.map(item => item.text).join('；'),
  }
}
