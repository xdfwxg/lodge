import { stageStatusOf } from './room-status.js'
import { CHAT_PHASE, ISSUE_STATE, STAGE_STATUS } from './states.js'

const ISSUE_STATE_OF = Object.freeze({
  active: ISSUE_STATE.in_progress,
  pending: ISSUE_STATE.todo,
  passed: ISSUE_STATE.done,
  blocked: ISSUE_STATE.blocked,
  waiting: ISSUE_STATE.blocked,
})

const items = text => String(text ?? '')
  .split('\n')
  .map(line => line.trim())
  .filter(line => line.startsWith('- '))
  .map(line => line.slice(2).trim())
  .filter(line => line !== '' && line !== '无')

const conclusionOf = messages => [...messages]
  .reverse()
  .find(message => message.kind === 'chat_conclusion')

const sectionOf = (text, heading) => {
  const match = String(text ?? '').match(new RegExp(`##\\s*${heading}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`))
  return match === null ? [] : items(match[1])
}

export const issuesOf = (room, messages = []) => {
  if (room?.roomType === 'studio') {
    return (room.stages ?? []).map((stage, index) => {
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
  }
  if (room?.roomType !== 'chat') return []
  const conclusion = conclusionOf(messages)
  if (conclusion !== undefined) {
    const todos = sectionOf(conclusion.text, '待办')
    return [
      {
        id: 'chat-conclusion',
        kind: 'decision',
        title: '这轮结论',
        state: 'done',
        stage: null,
        acceptance: null,
        ownerIds: [],
        blockers: [],
      },
      ...todos.map((title, index) => ({
        id: `chat-todo-${index}`,
        kind: 'todo',
        title,
        state: 'todo',
        stage: null,
        acceptance: null,
        ownerIds: [],
        blockers: [],
      })),
    ]
  }
  if (room?.chat?.phase === CHAT_PHASE.discussing) {
    return [{
      id: 'chat-discussion',
      kind: 'discussion',
      title: '还在讨论',
      state: 'in_progress',
      stage: null,
      acceptance: null,
      ownerIds: [],
      blockers: [],
    }]
  }
  return []
}
