import { createElement as h, useState } from 'react'

// 规划师把这一步交给人以后，界面要给出一个明确动作，而不是只剩输入框。
export const humanGateOf = room => {
  const stages = Array.isArray(room?.stages) ? room.stages : []
  const index = stages.findIndex(stage => stage.state === 'active')
  if (index < 0 || room?.state !== 'active') return null
  const decision = room.lastPlannerDecision
  if (decision?.stage !== index || decision?.kind !== 'human') return null
  const messages = Array.isArray(room.messages) ? room.messages : []
  const latest = [...messages].reverse()
    .find(message => message.kind === 'verdict' && (message.meta?.stage ?? 0) === index)
  if (latest === undefined || (latest.id ?? latest.seq) !== decision.verdictId) return null
  const judgment = decision.judgment ?? {}
  return {
    stage: index,
    title: stages[index].title ?? '',
    reason: typeof judgment.reason === 'string' ? judgment.reason : '',
    actionRequired: typeof judgment.actionRequired === 'string' ? judgment.actionRequired : '',
  }
}

export function HumanGateCard({ room, onRework = null }) {
  const gate = humanGateOf(room)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  if (gate === null || onRework === null) return null
  const submit = async () => {
    if (busy) return
    setBusy(true)
    const result = await onRework(gate.stage, note)
    setBusy(false)
    if (result !== null) setNote('')
  }
  return h('div', { className: 'crew-human-gate', role: 'group', 'aria-label': '轮到你决定' },
    h('b', null, `第 ${gate.stage + 1} 步「${gate.title}」轮到你决定`),
    h('p', null, gate.actionRequired || gate.reason || '看看这一步哪里还不够，把要改的写在下面。'),
    h('textarea', {
      className: 'crew-goal-input crew-human-gate-input',
      rows: 2,
      'aria-label': '补充要改什么',
      placeholder: '写上缺的信息或要怎么改；发送后这一步会重跑。',
      value: note,
      disabled: busy,
      onChange: event => setNote(event.target.value),
    }),
    h('div', { className: 'crew-human-gate-actions' },
      h('button', {
        type: 'button',
        className: 'crew-accept',
        disabled: busy || note.trim() === '',
        onClick: () => void submit(),
      }, busy ? '正在重跑…' : '补充并重跑')))
}
