import { createElement as h, useState } from 'react'

// 只有已通过、有代码起点记录的交付阶段可以回退。
export const rewindableStagesOf = room => (room?.stages ?? [])
  .map((stage, index) => ({ stage, index }))
  .filter(({ stage, index }) => (
    index > 0 &&
    stage.state === 'passed' &&
    (stage.kind === 'deliverable' || stage.manual === true) &&
    typeof room?.stageBases?.[index] === 'string'
  ))

export function RewindControl({ room, onRewind }) {
  const [armed, setArmed] = useState(null)
  const stages = rewindableStagesOf(room)
  if (room?.demo === true || room?.state !== 'active' || stages.length === 0) return null
  return h('div', { className: 'crew-stage-editor' },
    h('span', null, '回到阶段起点 · 代码重置到该阶段开始前，之后的阶段重来；证据不删除'),
    h('div', { className: 'crew-stage-edit-row' },
      stages.map(({ stage, index }) => h('button', {
        key: index,
        type: 'button',
        className: armed === index ? 'crew-choice' : 'crew-ghost',
        onClick: () => {
          if (armed !== index) {
            setArmed(index)
            return
          }
          setArmed(null)
          onRewind(index)
        },
      }, armed === index ? `确认回到阶段 ${index + 1}` : `回到阶段 ${index + 1}「${stage.title}」`))))
}
