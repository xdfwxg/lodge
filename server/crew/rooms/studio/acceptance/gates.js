import { STAGE_STATE } from '../../../../../shared/states.js'
import { reworkFloor } from './verifiers.js'
import { acceptanceOf } from './acceptance.js'

const deny = (reason, error) => ({ ok: false, reason, error })

// 完成 = 验收员通过。这里只回答一个问题：这一阶段能不能签收。
// 交付本身的规则（证明、包外改动）与判定规则（谁验、验完没有）都在 acceptance.js，
// 这一层只做签收前该问的几件事，然后把 blocker 原样交出去。
export const gateFor = (room, index, messages, evidence) => {
  const stage = Number.isInteger(index) ? room.stages[index] : undefined
  if (stage === undefined) return deny('invalid', '没有这个阶段')
  if (stage.state !== STAGE_STATE.active) return deny('conflict', '这个阶段不在待验收状态')
  const dependency = (Array.isArray(stage.dependsOn) ? stage.dependsOn : [])
    .find(item => room.stages[item]?.state !== STAGE_STATE.passed)
  if (dependency !== undefined) return deny('conflict', `先完成阶段 ${dependency + 1}，再验收这一阶段`)
  if (room.openQuestion !== null && room.openQuestion !== undefined) {
    return deny('conflict', '还有问题没回答，回答后再继续')
  }
  const ordered = Array.isArray(messages) ? messages : []
  const acceptance = acceptanceOf({
    room,
    stageIndex: index,
    messages: ordered,
    evidence,
    floor: reworkFloor(ordered, index),
  })
  if (!acceptance.ok) {
    const [first] = acceptance.blockers
    return deny(first.reason, first.text)
  }
  return { ok: true, stage }
}
