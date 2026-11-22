import { CHAT_PHASE, ISSUE_STATE } from '../../../../shared/states.js'

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

export const chatIssuesOf = (room, messages = []) => {
  const conclusion = conclusionOf(messages)
  if (conclusion !== undefined) {
    const todos = sectionOf(conclusion.text, '待办')
    return [
      {
        id: 'chat-conclusion',
        kind: 'decision',
        title: '这轮结论',
        state: ISSUE_STATE.done,
        stage: null,
        acceptance: null,
        ownerIds: [],
        blockers: [],
      },
      ...todos.map((title, index) => ({
        id: `chat-todo-${index}`,
        kind: 'todo',
        title,
        state: ISSUE_STATE.todo,
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
      state: ISSUE_STATE.in_progress,
      stage: null,
      acceptance: null,
      ownerIds: [],
      blockers: [],
    }]
  }
  return []
}

export const chatRetroOf = room => {
  const items = []
  const rounds = room?.chat?.round ?? 1
  if (rounds > 1) {
    items.push({
      kind: 'rounds',
      text: `讨论用了 ${rounds} 轮才收敛`,
      suggestion: '下一轮开场先写清判断标准，让分歧更早暴露。',
    })
  }
  if (room?.chat?.turns >= room?.chat?.turnLimit) {
    items.push({
      kind: 'turns',
      text: '讨论用满了发言上限',
      suggestion: '把话题缩成一个可决定的选项，再开新一轮。',
    })
  }
  const trimmed = items.slice(0, 3)
  return {
    mode: 'chat',
    items: trimmed,
    summary: trimmed.length === 0 ? '这次没有明显摩擦' : trimmed.map(item => item.text).join('；'),
  }
}
